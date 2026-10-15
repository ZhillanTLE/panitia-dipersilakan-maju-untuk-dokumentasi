import { describe, expect, it } from 'vitest';
import { cardFor, cardWords } from './cards';
import { frameFeatures, NucleusDetector, SyllableMap, syllableCount } from './syllables';

describe('syllableCount', () => {
  it('counts Indonesian syllables from vowels', () => {
    const cases: [string, number][] = [
      ['setiap', 3],
      ['hari', 2],
      ['minggu', 2],
      ['ke', 1],
      ['menyiram', 3],
      ['belakang', 3],
      ['cabai', 2],
      ['pulau', 2],
      ['baik', 2],
      ['bayam', 2],
      ['ba', 1],
      ['m', 1],
    ];
    for (const [word, n] of cases) expect(syllableCount(word), word).toBe(n);
  });
});

describe('SyllableMap', () => {
  const map = new SyllableMap(cardWords(cardFor('kalimat')));
  // Ibu(2) membeli(3) sayur(2) di(1) pasar(2) ...

  it('finishes a word on its last syllable', () => {
    expect(map.wordsDone(0)).toBe(0);
    expect(map.wordsDone(1)).toBe(0);
    expect(map.wordsDone(2)).toBe(1);
    expect(map.wordsDone(5)).toBe(2);
  });

  it('reports progress inside the current word', () => {
    expect(map.progressIn(3)).toBeCloseTo(1 / 3);
    expect(map.startOf(2)).toBe(5);
  });
});

/** Frames for syllables: loud 150 ms vowels separated by quieter 100 ms consonant dips. */
function syllableFrames(count: number, dipRms = 0.01): { rms: number; zcr: number }[] {
  const frames: { rms: number; zcr: number }[] = [];
  const quiet = (n: number) => {
    for (let k = 0; k < n; k++) frames.push({ rms: 0.0005, zcr: 900 });
  };
  quiet(40);
  for (let s = 0; s < count; s++) {
    for (let k = 0; k < 15; k++) frames.push({ rms: 0.02 + 0.1 * Math.sin((Math.PI * k) / 14), zcr: 1200 });
    for (let k = 0; k < 10; k++) frames.push({ rms: dipRms, zcr: 1500 });
  }
  quiet(60);
  return frames;
}

function nuclei(frames: { rms: number; zcr: number }[]): number[] {
  const d = new NucleusDetector();
  return frames.map((f) => d.push(f.rms, f.zcr).nucleusAt).filter((t): t is number => t !== null);
}

describe('NucleusDetector', () => {
  it('finds one nucleus per syllable', () => {
    expect(nuclei(syllableFrames(7))).toHaveLength(7);
  });

  it('ignores silence and background noise', () => {
    expect(nuclei(Array.from({ length: 300 }, (_, k) => ({ rms: 0.0005 + (k % 3) * 0.0001, zcr: 900 })))).toHaveLength(0);
  });

  it('ignores hiss', () => {
    const hiss = syllableFrames(5).map((f) => ({ ...f, zcr: 7000 }));
    expect(nuclei(hiss)).toHaveLength(0);
  });

  it('merges a vowel whose loudness only wobbles', () => {
    const frames = syllableFrames(1);
    const wobble = frames.map((f, k) => ({ ...f, rms: f.rms > 0.05 ? f.rms * (k % 2 ? 1 : 0.95) : f.rms }));
    expect(nuclei(wobble)).toHaveLength(1);
  });

  it('is deterministic', () => {
    const frames = syllableFrames(6);
    expect(nuclei(frames)).toEqual(nuclei(frames));
  });
});

describe('frameFeatures', () => {
  it('gives one frame per 10 ms and separates vowels from hiss', () => {
    const rate = 16000;
    const vowel = Float32Array.from({ length: rate / 10 }, (_, k) => 0.3 * Math.sin((2 * Math.PI * 600 * k) / rate));
    let seed = 1;
    const noise = Float32Array.from({ length: rate / 10 }, () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.3;
    });
    const v = frameFeatures(vowel, rate);
    const n = frameFeatures(noise, rate);
    expect(v).toHaveLength(10);
    expect(v[5].zcr).toBeLessThan(1500);
    expect(n[5].zcr).toBeGreaterThan(4500);
    expect(v[5].rms).toBeGreaterThan(n[5].rms);
  });
});
