import { describe, expect, it } from 'vitest';
import { forcedAlign, greedyWords, makeVocab, targetsFor, type LogProbs } from './ctc';

// Tiny vocab in the model's layout: letters, a word delimiter and the blank.
const vocab = makeVocab(['a', 'b', 'i', 'u', '|', '[UNK]', '[PAD]'], 6, '|');
const ID: Record<string, number> = { a: 0, b: 1, i: 2, u: 3, '|': 4, _: 6 };

/** Log-probs whose best path is `path` (one symbol per frame, "_" is blank). */
function frames(path: string): LogProbs {
  const V = vocab.tokens.length;
  const data = new Float32Array(path.length * V).fill(Math.log(0.1 / (V - 1)));
  [...path].forEach((ch, f) => (data[f * V + ID[ch]] = Math.log(0.9)));
  return { data, frames: path.length, vocab: V };
}

describe('greedyWords', () => {
  it('collapses repeats, drops blanks and splits on the delimiter', () => {
    const words = greedyWords(frames('_bb_u__|_ii__bu_'), vocab);
    expect(words.map((w) => w.text)).toEqual(['bu', 'ibu']);
    expect(words[0]).toMatchObject({ startFrame: 1, endFrame: 5 });
    expect(words[1]).toMatchObject({ startFrame: 9, endFrame: 15 });
  });

  it('keeps a doubled letter only when a blank separates it', () => {
    expect(greedyWords(frames('aa_a'), vocab).map((w) => w.text)).toEqual(['aa']);
    expect(greedyWords(frames('aaa'), vocab).map((w) => w.text)).toEqual(['a']);
  });

  it('returns nothing for silence', () => {
    expect(greedyWords(frames('______'), vocab)).toEqual([]);
  });
});

describe('targetsFor', () => {
  it('spells words with delimiters and maps each letter to its word', () => {
    expect(targetsFor(['ibu', 'ab'], vocab)).toEqual({ ids: [2, 1, 3, 4, 0, 1], wordOf: [0, 0, 0, -1, 1, 1] });
  });
});

describe('forcedAlign', () => {
  it('places each word where its letters are heard', () => {
    const spans = forcedAlign(frames('__ii_bbu___|__aa_bb__'), vocab, ['ibu', 'ab']);
    expect(spans).not.toBeNull();
    expect(spans![0].startFrame).toBe(2);
    expect(spans![0].endFrame).toBe(8);
    expect(spans![1].startFrame).toBe(14);
    expect(spans![1].endFrame).toBe(19);
    expect(spans![0].fit).toBeCloseTo(0);
  });

  it('reports a poor fit when the audio says something else', () => {
    const good = forcedAlign(frames('__ii_bbu__'), vocab, ['ibu'])!;
    const bad = forcedAlign(frames('__aa_aaa__'), vocab, ['ibu'])!;
    expect(bad[0].fit).toBeLessThan(good[0].fit - 1);
  });

  it('needs at least one frame per letter', () => {
    expect(forcedAlign(frames('ib'), vocab, ['ibu'])).toBeNull();
  });
});
