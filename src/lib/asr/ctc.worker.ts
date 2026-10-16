/// <reference lib="webworker" />
// The WASM-only build: the WebGPU bundle crashes in Chrome inside its JSEP glue
// ("reading 'Xe'"), and the int8 model runs on the CPU anyway.
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { readPackFile, type PackLocation, type PackManifest } from './pack';

// Runs the acoustic model off the main thread, so the highlight and the page stay smooth.

export type Backend = 'webgpu' | 'wasm';

export type WorkerRequest =
  | { type: 'load'; location: PackLocation; manifest: PackManifest; prefer: Backend | 'auto'; threads?: number }
  | { type: 'run'; id: number; audio: Float32Array };

export type WorkerReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; backend: Backend; threads: number; loadMs: number; warmMs: number }
  | { type: 'result'; id: number; data: Float32Array; frames: number; vocab: number; ms: number }
  | { type: 'error'; id?: number; message: string };

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
let threads = 1;

let session: ort.InferenceSession | null = null;

const post = (reply: WorkerReply, transfer: Transferable[] = []) => self.postMessage(reply, transfer);

async function create(location: PackLocation, file: string, backend: Backend): Promise<ort.InferenceSession> {
  const bytes = await readPackFile(location, file, (loaded, total) => post({ type: 'progress', loaded, total }));
  return ort.InferenceSession.create(new Uint8Array(bytes), {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
  });
}

async function load(location: PackLocation, manifest: PackManifest, prefer: Backend | 'auto', wanted?: number): Promise<void> {
  const t0 = performance.now();
  // WASM threads need cross-origin isolation; the GPU path does not use them.
  threads = self.crossOriginIsolated ? Math.max(1, wanted ?? Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  ort.env.wasm.numThreads = threads;
  const backend: Backend = 'wasm';
  void prefer;
  session = await create(location, manifest.variants.cpu, 'wasm');
  const loadMs = performance.now() - t0;

  // One warm-up run compiles kernels (and GPU shaders) before the first child reads.
  const t1 = performance.now();
  const warm = new Float32Array(16000 * 2).map((_, k) => Math.sin(k / 9) * 0.01);
  await session.run({ audio: new ort.Tensor('float32', warm, [1, warm.length]) });
  post({ type: 'ready', backend, threads: backend === 'wasm' ? threads : 0, loadMs, warmMs: performance.now() - t1 });
}

async function run(id: number, audio: Float32Array): Promise<void> {
  if (!session) throw new Error('model not loaded');
  const t0 = performance.now();
  const output = await session.run({ audio: new ort.Tensor('float32', audio, [1, audio.length]) });
  const tensor = output[session.outputNames[0]];
  const data = new Float32Array(tensor.data as Float32Array);
  tensor.dispose?.();
  post({ type: 'result', id, data, frames: tensor.dims[1], vocab: tensor.dims[2], ms: performance.now() - t0 }, [data.buffer]);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'load') {
    load(msg.location, msg.manifest, msg.prefer, msg.threads).catch((e: unknown) => post({ type: 'error', message: String(e) }));
  } else {
    run(msg.id, msg.audio).catch((e: unknown) => post({ type: 'error', id: msg.id, message: String(e) }));
  }
};
