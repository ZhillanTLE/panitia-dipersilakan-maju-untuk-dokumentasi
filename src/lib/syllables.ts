import type { CardWord } from '../types';

// Voice-paced highlight: the highlight steps through the card syllable by syllable as the
// reader speaks, straight from the microphone signal, with no recognizer and no network.
// Indonesian spelling is regular, so a word's syllable count comes from its vowels.
// UI only: this never feeds a score (CLAUDE.md rule 4).

const VOWELS = 'aiueo';

/** Syllables in a normalized word. Word-final ai/au/oi/ei is one syllable (ca-bai, pu-lau). */
export function syllableCount(norm: string): number {
  if (norm.length <= 1) return 1;
  let count = 0;
  for (let k = 0; k < norm.length; k++) {
    if (!VOWELS.includes(norm[k])) continue;
    count++;
    if (k + 2 === norm.length && ['ai', 'au', 'oi', 'ei'].includes(norm.slice(k, k + 2))) break;
  }
  return Math.max(1, count);
}

/** Maps a running syllable count onto card words. */
export class SyllableMap {
  private readonly ends: number[];

  constructor(words: CardWord[]) {
    let total = 0;
    this.ends = words.map((w) => (total += syllableCount(w.norm)));
  }

  get total(): number {
    return this.ends[this.ends.length - 1] ?? 0;
  }

  /** Words fully spoken after `syllables` syllables. */
  wordsDone(syllables: number): number {
    let done = 0;
    while (done < this.ends.length && this.ends[done] <= syllables) done++;
    return done;
  }

  /** Syllables before word `i`. */
  startOf(i: number): number {
    return i <= 0 ? 0 : (this.ends[Math.min(i, this.ends.length) - 1] ?? 0);
  }

  /** 0..1 progress through the current word. */
  progressIn(syllables: number): number {
    const word = this.wordsDone(syllables);
    if (word >= this.ends.length) return 1;
    const start = this.startOf(word);
    return (syllables - start) / (this.ends[word] - start);
  }
}

export interface FrameResult {
  /** Voice is present in this frame. */
  voiced: boolean;
  /** A syllable nucleus was confirmed; its time in ms. */
  nucleusAt: number | null;
}

// Tuning for 10 ms frames. Loosely after de Jong & Wempe (2009): a syllable nucleus is a
// loudness peak that rises out of a dip and stands clear of the background noise.
const FRAME_MS = 10;

export interface DetectorTuning {
  /** Envelope smoothing, 0..1 weight of the newest frame. */
  smoothing: number;
  /** How far loudness must fall after a peak, and rise after a dip, to count. */
  dipDb: number;
  minAboveFloorDb: number;
  voiceAboveFloorDb: number;
  maxBelowPeakDb: number;
  minGapMs: number;
  /** Zero crossings per second above this are hiss (s, sy, c), not a vowel. */
  maxZcrHz: number;
}

/**
 * Swept against Windows TTS reading the Kebun Nenek and word cards: 99% of syllables
 * found at a slow pace, 105% on the word card, 85% at a fast pace. It errs low on
 * purpose, so the highlight trails a fast reader instead of running ahead of a slow one.
 */
export const DEFAULT_TUNING: DetectorTuning = {
  smoothing: 0.16,
  dipDb: 2,
  minAboveFloorDb: 12,
  voiceAboveFloorDb: 9,
  maxBelowPeakDb: 28,
  minGapMs: 180,
  maxZcrHz: 4500,
};

/**
 * Finds syllable nuclei in a stream of 10 ms frames (band-limited RMS and the raw
 * zero crossings per second). Deterministic: the same frames always give the same nuclei.
 */
export class NucleusDetector {
  private readonly k: DetectorTuning;
  private t = 0;
  private smooth: number | null = null;
  private floor: number | null = null;
  private peak = -120;
  private valley = Infinity;
  private candidate: { db: number; t: number; zcr: number } | null = null;
  private lastNucleus = -Infinity;

  constructor(tuning: Partial<DetectorTuning> = {}) {
    this.k = { ...DEFAULT_TUNING, ...tuning };
  }

  push(rms: number, zcr: number): FrameResult {
    const k = this.k;
    const t = (this.t += FRAME_MS);
    const raw = 20 * Math.log10(rms + 1e-7);
    this.smooth = this.smooth === null ? raw : this.smooth * (1 - k.smoothing) + raw * k.smoothing;
    const db = this.smooth;

    // Background level: drops fast to quieter frames, creeps up about 0.6 dB per second, and
    // never comes within 20 dB of the loudest recent speech, so a long reading can't bury it.
    this.peak = Math.max(this.peak - 0.02, db);
    this.floor = this.floor === null ? db : db < this.floor ? this.floor * 0.6 + db * 0.4 : this.floor + 0.006;
    this.floor = Math.min(this.floor, this.peak - 20);

    const voiced = db > this.floor + k.voiceAboveFloorDb && db > this.peak - k.maxBelowPeakDb && zcr < k.maxZcrHz;
    let nucleusAt: number | null = null;

    if (!this.candidate) {
      this.valley = Math.min(this.valley, db);
      if (voiced && db > this.valley + k.dipDb) this.candidate = { db, t, zcr };
    } else if (db >= this.candidate.db) {
      this.candidate = { db, t, zcr };
    } else if (db < this.candidate.db - k.dipDb) {
      const c = this.candidate;
      if (c.t - this.lastNucleus >= k.minGapMs && c.db > this.floor + k.minAboveFloorDb && c.zcr < k.maxZcrHz) {
        nucleusAt = c.t;
        this.lastNucleus = c.t;
      }
      this.candidate = null;
      this.valley = db;
    }
    return { voiced, nucleusAt };
  }
}

/**
 * The per-frame features the audio worklet computes: RMS of the 300 to 3000 Hz band (where
 * vowels carry their energy) and the raw signal's zero crossings per second, per 10 ms.
 * pcm-worklet.js implements the same math on the audio thread; keep the two in step.
 */
export function frameFeatures(samples: Float32Array, sampleRate: number): { rms: number; zcr: number }[] {
  const hop = Math.round(sampleRate * (FRAME_MS / 1000));
  const hpA = Math.exp((-2 * Math.PI * 300) / sampleRate);
  const lpA = Math.exp((-2 * Math.PI * 3000) / sampleRate);
  let hpIn = 0;
  let hpOut = 0;
  let lpOut = 0;
  let prev = 0;
  let energy = 0;
  let crossings = 0;
  let n = 0;
  const out: { rms: number; zcr: number }[] = [];
  for (const x of samples) {
    hpOut = hpA * (hpOut + x - hpIn);
    hpIn = x;
    lpOut = (1 - lpA) * hpOut + lpA * lpOut;
    energy += lpOut * lpOut;
    if (x >= 0 !== prev >= 0) crossings++;
    prev = x;
    if (++n === hop) {
      out.push({ rms: Math.sqrt(energy / n), zcr: (crossings / n) * sampleRate });
      energy = 0;
      crossings = 0;
      n = 0;
    }
  }
  return out;
}
