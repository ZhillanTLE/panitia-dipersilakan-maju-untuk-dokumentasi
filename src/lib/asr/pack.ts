// Model packs (CLAUDE.md, "Model pack"): a versioned folder with the model files, the
// vocabulary, thresholds and a manifest of SHA-256 hashes. The teacher installs one from a
// local folder (copied by cable or SD card) into the browser's private storage; nothing is
// downloaded. During development the same folder is served next to the app.

export const PACK_VERSION = 'ctc-id@0.1-int8';
const OPFS_DIR = 'modelpacks';

export interface PackManifest {
  version: string;
  created: string;
  source: { model: string; license: string };
  audio: { sample_rate: number; frame_ms: number };
  ctc: { blank_id: number; word_delimiter: string };
  variants: { cpu: string; gpu?: string };
  files: { name: string; bytes: number; sha256: string }[];
}

export interface PackThresholds {
  near_similarity: number;
  /** Mean forced-alignment fit below which a word the decoder heard as correct still needs review. */
  fit_review: number;
  /** Fit at or above which the audio matches the card word as well as anything, so a mismatch is doubtful. */
  fit_agree: number;
}

/** Where a pack lives. Plain data, so it can be posted to the worker. */
export type PackLocation = { kind: 'opfs'; dir: string } | { kind: 'url'; base: string };

export interface Pack {
  location: PackLocation;
  manifest: PackManifest;
  vocab: string[];
  thresholds: PackThresholds;
}

const DEFAULT_THRESHOLDS: PackThresholds = { near_similarity: 0.75, fit_review: -2, fit_agree: -0.3 };

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR, { create: true });
  } catch {
    return null;
  }
}

/** Reads one file of a pack, reporting progress for large ones. */
export async function readPackFile(
  location: PackLocation,
  name: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  if (location.kind === 'opfs') {
    const root = await navigator.storage.getDirectory();
    const dir = await (await root.getDirectoryHandle(OPFS_DIR)).getDirectoryHandle(location.dir);
    const file = await (await dir.getFileHandle(name)).getFile();
    onProgress?.(file.size, file.size);
    return file.arrayBuffer();
  }
  const response = await fetch(`${location.base}${name}`);
  if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress?.(loaded, total || loaded);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
}

async function readJson<T>(location: PackLocation, name: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readPackFile(location, name))) as T;
}

async function open(location: PackLocation): Promise<Pack> {
  const manifest = await readJson<PackManifest>(location, 'manifest.json');
  const vocab = await readJson<string[]>(location, 'vocab.json');
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(await readJson<Partial<PackThresholds>>(location, 'thresholds.json')) };
  return { location, manifest, vocab, thresholds };
}

/** An installed pack first, then one served next to the app. Null when there is none. */
export async function findPack(): Promise<Pack | null> {
  const root = await opfsRoot();
  if (root) {
    try {
      const dir = await root.getDirectoryHandle(PACK_VERSION);
      await dir.getFileHandle('manifest.json');
      return await open({ kind: 'opfs', dir: PACK_VERSION });
    } catch {
      // Not installed.
    }
  }
  try {
    // Absolute, because the worker resolves relative URLs against its own script.
    const base = new URL(`./modelpack/${encodeURIComponent(PACK_VERSION)}/`, document.baseURI).href;
    return await open({ kind: 'url', base });
  } catch {
    return null;
  }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Installs a pack from the files of a folder the teacher picked. Every file named in the
 * manifest must be present and match its SHA-256, or nothing is installed.
 */
export async function installPack(files: File[], onProgress?: (step: string) => void): Promise<PackManifest> {
  const byName = new Map(files.map((f) => [f.name, f]));
  const manifestFile = byName.get('manifest.json');
  if (!manifestFile) throw new Error('manifest.json tidak ditemukan di folder itu.');
  const manifest = JSON.parse(await manifestFile.text()) as PackManifest;
  const needed = manifest.files.filter((f) => f.name === manifest.variants.cpu || f.name === manifest.variants.gpu || !f.name.endsWith('.onnx'));

  for (const entry of needed) {
    const file = byName.get(entry.name);
    if (!file) throw new Error(`${entry.name} tidak ada di folder.`);
    onProgress?.(`Memeriksa ${entry.name}`);
    if ((await sha256Hex(await file.arrayBuffer())) !== entry.sha256) {
      throw new Error(`${entry.name} tidak cocok dengan manifest. Paket ditolak.`);
    }
  }

  const root = await opfsRoot();
  if (!root) throw new Error('Penyimpanan peramban tidak tersedia.');
  const dir = await root.getDirectoryHandle(manifest.version, { create: true });
  for (const entry of [...needed, { name: 'manifest.json' }]) {
    onProgress?.(`Menyimpan ${entry.name}`);
    const writable = await (await dir.getFileHandle(entry.name, { create: true })).createWritable();
    await writable.write(byName.get(entry.name)!);
    await writable.close();
  }
  return manifest;
}
