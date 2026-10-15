import type { Quality } from '../types';
import workletUrl from './pcm-worklet.js?url&no-inline';

// Records the take as 16 kHz mono PCM16 WAV, the format the contract and the research
// harness expect, and runs the quality gate on the raw samples.

const TARGET_RATE = 16000;
// Draft quality-gate thresholds. Spike 4 (classroom audio) sets the real ones.
const SPEECH_RMS = 0.02;
const MIN_SPEECH_RATIO = 0.15;
const MAX_CLIPPING_PCT = 1;

export interface Recording {
  wav: Blob;
  duration_ms: number;
  quality: Quality;
}

export interface Capture {
  /** 0..1 loudness of the last few milliseconds, for the level line. */
  level(): number;
  stop(): Promise<Recording>;
  cancel(): void;
}

export async function startCapture(): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
  });
  const ctx = new AudioContext();
  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw error;
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const capture = new AudioWorkletNode(ctx, 'pcm-capture');
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(analyser);
  source.connect(capture);
  capture.connect(silent).connect(ctx.destination);

  const chunks: Float32Array[] = [];
  capture.port.onmessage = (event: MessageEvent<Float32Array>) => chunks.push(event.data);
  const frame = new Float32Array(analyser.fftSize);

  const teardown = async () => {
    capture.port.onmessage = null;
    source.disconnect();
    capture.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    if (ctx.state !== 'closed') await ctx.close();
  };

  return {
    level() {
      analyser.getFloatTimeDomainData(frame);
      let sum = 0;
      for (const v of frame) sum += v * v;
      return Math.min(1, Math.sqrt(sum / frame.length) * 5);
    },
    async stop() {
      const rate = ctx.sampleRate;
      await teardown();
      const raw = concat(chunks);
      const pcm = downsample(raw, rate, TARGET_RATE);
      return {
        wav: encodeWav(pcm, TARGET_RATE),
        duration_ms: Math.round((pcm.length / TARGET_RATE) * 1000),
        quality: measureQuality(raw, rate),
      };
    },
    cancel() {
      void teardown();
    },
  };
}

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Box-filter decimation. Good enough for review playback and the harness's own resampler. */
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let k = 0; k < out.length; k++) {
    const start = Math.floor(k * ratio);
    const end = Math.min(input.length, Math.floor((k + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[k] = sum / Math.max(1, end - start);
  }
  return out;
}

export function measureQuality(pcm: Float32Array, rate: number): Quality {
  const size = Math.max(1, Math.round(rate * 0.02));
  let frames = 0;
  let speech = 0;
  let clipped = 0;
  for (let k = 0; k + size <= pcm.length; k += size) {
    let sum = 0;
    for (let j = k; j < k + size; j++) {
      sum += pcm[j] * pcm[j];
      if (Math.abs(pcm[j]) >= 0.99) clipped++;
    }
    frames++;
    if (Math.sqrt(sum / size) > SPEECH_RMS) speech++;
  }
  const speech_ratio = frames ? Math.round((speech / frames) * 100) / 100 : 0;
  const clipping_pct = pcm.length ? Math.round((clipped / pcm.length) * 10000) / 100 : 0;
  const ok = speech_ratio >= MIN_SPEECH_RATIO && clipping_pct <= MAX_CLIPPING_PCT;
  return { status: ok ? 'ok' : 'retry_suggested', speech_ratio, clipping_pct };
}

function encodeWav(pcm: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let k = 0; k < s.length; k++) view.setUint8(offset + k, s.charCodeAt(k));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let k = 0; k < pcm.length; k++) {
    const s = Math.max(-1, Math.min(1, pcm[k]));
    view.setInt16(44 + k * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
