import type { CardWord } from '../types';
import { misreadings, type HeardToken } from './scoring';
import type { HeardStream } from './speech';

// Scripted reader for trying the flow without a child or a microphone. Sessions made
// with it are stored as `simulated` and never count as a child's result (CLAUDE.md,
// "Testing and evaluation"). The script is seeded, so the same seed replays the same reading.

type Step =
  | { kind: 'say'; i: number; text: string; ms: number }
  | { kind: 'stall'; i: number; ms: number }
  | { kind: 'pause'; ms: number };

function hash(text: string): number {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A near-miss the recognizer might produce: last letter dropped, or one vowel changed. */
function nearMiss(word: string, rand: () => number): string {
  if (word.length > 3 && rand() < 0.5) return word.slice(0, -1);
  const vowels = 'aiueo';
  const k = [...word].findIndex((c) => vowels.includes(c));
  if (k === -1) return word + 'a';
  const swap = vowels[(vowels.indexOf(word[k]) + 1 + Math.floor(rand() * 4)) % 5];
  return word.slice(0, k) + swap + word.slice(k + 1);
}

function misread(word: string, rand: () => number): string {
  const options = [...misreadings(word)];
  return options.length ? options[Math.floor(rand() * options.length)] : nearMiss(word, rand);
}

export function simulationScript(words: CardWord[], seed: string): Step[] {
  const rand = mulberry32(hash(seed));
  const errorRate = 0.02 + rand() * 0.2;
  const pace = 1 + rand() * 0.7;
  const steps: Step[] = [];

  for (const w of words) {
    const ms = Math.round((240 + 60 * w.norm.length) * pace * (0.85 + rand() * 0.3));
    const say = (text: string): Step => ({ kind: 'say', i: w.i, text, ms });
    const r = rand() / errorRate;
    if (r < 0.3) steps.push(say(misread(w.norm, rand)));
    else if (r < 0.45) steps.push(say(nearMiss(w.norm, rand)));
    else if (r < 0.6) {
      // Skips the word.
    } else if (r < 0.72) steps.push(say(w.text), say(w.text));
    else if (r < 0.84) steps.push(say(misread(w.norm, rand)), say(w.text));
    else if (r < 1) steps.push({ kind: 'stall', i: w.i, ms: 4200 }, say(w.text));
    else steps.push(say(w.text));
    if (/[.!?]$/.test(w.text)) steps.push({ kind: 'pause', ms: Math.round(420 * pace) });
  }
  return steps;
}

export class SimulatedStream implements HeardStream {
  readonly finished: Promise<void>;
  private resolveFinished: () => void = () => {};
  private heard: HeardToken[] = [];
  private k = 0;
  private t0 = 0;
  private timer = 0;
  private speakingUntil = 0;
  private stalledOn: number | null = null;
  private onLive: (tokens: HeardToken[]) => void = () => {};

  constructor(private readonly steps: Step[]) {
    this.finished = new Promise((resolve) => (this.resolveFinished = resolve));
  }

  start(onLive: (tokens: HeardToken[]) => void): void {
    this.onLive = onLive;
    this.t0 = performance.now();
    this.timer = window.setTimeout(() => this.next(), 650);
  }

  private next(): void {
    const step = this.steps[this.k++];
    if (!step) {
      this.resolveFinished();
      return;
    }
    if (step.kind === 'say') {
      const startedAt = performance.now() - this.t0;
      this.speakingUntil = performance.now() + step.ms;
      this.timer = window.setTimeout(() => {
        this.heard.push({ text: step.text, t_ms: Math.round(startedAt) });
        this.onLive([...this.heard]);
        this.next();
      }, step.ms);
    } else if (step.kind === 'stall') {
      this.stalledOn = step.i;
      this.timer = window.setTimeout(() => {
        this.stalledOn = null;
        this.next();
      }, step.ms);
    } else {
      this.timer = window.setTimeout(() => this.next(), step.ms);
    }
  }

  supply(i: number): void {
    if (this.stalledOn !== i) return;
    window.clearTimeout(this.timer);
    this.stalledOn = null;
    while (this.steps[this.k]?.kind === 'say' && (this.steps[this.k] as { i: number }).i === i) this.k++;
    this.timer = window.setTimeout(() => this.next(), 500);
  }

  level(): number {
    const now = performance.now();
    return now < this.speakingUntil ? 0.3 + 0.4 * Math.abs(Math.sin(now / 85)) : 0.015;
  }

  stop(): Promise<HeardToken[]> {
    window.clearTimeout(this.timer);
    this.resolveFinished();
    return Promise.resolve([...this.heard]);
  }

  cancel(): void {
    window.clearTimeout(this.timer);
  }
}

/** The same scripted reading, resolved instantly into timed words (no stalls are supplied). */
export function simulateTokens(words: CardWord[], seed: string): HeardToken[] {
  let t = 650;
  const out: HeardToken[] = [];
  for (const step of simulationScript(words, seed)) {
    if (step.kind === 'say') out.push({ text: step.text, t_ms: t });
    t += step.ms;
  }
  return out;
}
