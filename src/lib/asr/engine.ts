import { useSyncExternalStore } from 'react';
import { makeVocab, type LogProbs, type Vocab } from './ctc';
import type { Backend, WorkerReply, WorkerRequest } from './ctc.worker';
import { findPack, type Pack } from './pack';

// Main-thread handle on the acoustic model. One shared instance: the model is large, so it
// loads once per page and every reading reuses it.

export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
  loaded?: number;
  total?: number;
  backend?: Backend;
  threads?: number;
  version?: string;
  loadMs?: number;
  error?: string;
}

class CtcEngine {
  private worker: Worker | null = null;
  private loading: Promise<boolean> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: { lp: LogProbs; ms: number }) => void; reject: (e: Error) => void }>();
  private listeners = new Set<() => void>();
  status: EngineStatus = { state: 'idle' };
  pack: Pack | null = null;
  vocab: Vocab | null = null;

  private set(status: EngineStatus): void {
    this.status = status;
    this.listeners.forEach((l) => l());
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  /** Finds the pack and loads the model; resolves false when there is no pack or it fails. */
  load(prefer: Backend | 'auto' = 'auto', threads?: number): Promise<boolean> {
    this.loading ??= this.start(prefer, threads);
    return this.loading;
  }

  private async start(prefer: Backend | 'auto', threads?: number): Promise<boolean> {
    this.set({ state: 'loading' });
    const pack = await findPack();
    if (!pack) {
      this.set({ state: 'missing' });
      this.loading = null;
      return false;
    }
    this.pack = pack;
    this.vocab = makeVocab(pack.vocab, pack.manifest.ctc.blank_id, pack.manifest.ctc.word_delimiter);
    const worker = new Worker(new URL('./ctc.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<boolean>((resolve) => {
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const msg = event.data;
        if (msg.type === 'progress') {
          this.set({ state: 'loading', loaded: msg.loaded, total: msg.total, version: pack.manifest.version });
        } else if (msg.type === 'ready') {
          this.set({ state: 'ready', backend: msg.backend, threads: msg.threads, version: pack.manifest.version, loadMs: msg.loadMs });
          resolve(true);
        } else if (msg.type === 'result') {
          this.pending.get(msg.id)?.resolve({ lp: { data: msg.data, frames: msg.frames, vocab: msg.vocab }, ms: msg.ms });
          this.pending.delete(msg.id);
        } else if (msg.id !== undefined) {
          this.pending.get(msg.id)?.reject(new Error(msg.message));
          this.pending.delete(msg.id);
        } else {
          this.set({ state: 'error', error: msg.message, version: pack.manifest.version });
          this.loading = null;
          worker.terminate();
          this.worker = null;
          resolve(false);
        }
      };
      const request: WorkerRequest = { type: 'load', location: pack.location, manifest: pack.manifest, prefer, threads };
      worker.postMessage(request);
    });
  }

  /** Log-probabilities for 16 kHz mono audio. */
  run(audio: Float32Array): Promise<{ lp: LogProbs; ms: number }> {
    const worker = this.worker;
    if (!worker || this.status.state !== 'ready') return Promise.reject(new Error('model not ready'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: WorkerRequest = { type: 'run', id, audio };
      worker.postMessage(request, [audio.buffer]);
    });
  }

  /** Forgets the loaded model, for example after a new pack is installed. */
  reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.pack = null;
    this.vocab = null;
    this.set({ state: 'idle' });
  }
}

export const engine = new CtcEngine();

export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(engine.subscribe, () => engine.status);
}
