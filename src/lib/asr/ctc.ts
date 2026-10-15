// CTC utilities for a character-level acoustic model: greedy decoding with frame spans,
// and Viterbi forced alignment of known text (slow-path steps 5 and 7 in CLAUDE.md).
// Pure and deterministic, so they run the same in the worker, the page and the tests.

/** Row-major [frames, vocab] log-probabilities from the model. */
export interface LogProbs {
  data: Float32Array;
  frames: number;
  vocab: number;
}

export interface Vocab {
  tokens: string[];
  blank: number;
  delimiter: number;
  index: Map<string, number>;
}

export function makeVocab(tokens: string[], blank: number, delimiter: string): Vocab {
  const index = new Map(tokens.map((t, i) => [t, i]));
  const delimiterId = index.get(delimiter);
  if (delimiterId === undefined) throw new Error(`delimiter ${delimiter} not in vocab`);
  return { tokens, blank, delimiter: delimiterId, index };
}

export interface DecodedWord {
  text: string;
  /** First frame that emitted a letter of the word. */
  startFrame: number;
  /** One past the last emitting frame. */
  endFrame: number;
}

function argmaxRow(lp: LogProbs, f: number): number {
  const base = f * lp.vocab;
  let best = 0;
  let bestValue = lp.data[base];
  for (let v = 1; v < lp.vocab; v++) {
    if (lp.data[base + v] > bestValue) {
      bestValue = lp.data[base + v];
      best = v;
    }
  }
  return best;
}

/** Best path per frame, repeats collapsed and blanks dropped, split into words. No language model. */
export function greedyWords(lp: LogProbs, vocab: Vocab): DecodedWord[] {
  const words: DecodedWord[] = [];
  let text = '';
  let start = -1;
  let last = -1;
  let prev = -1;
  const flush = () => {
    if (text) words.push({ text, startFrame: start, endFrame: last + 1 });
    text = '';
    start = -1;
  };
  for (let f = 0; f < lp.frames; f++) {
    const id = argmaxRow(lp, f);
    if (id !== prev && id !== vocab.blank) {
      if (id === vocab.delimiter) flush();
      else {
        const token = vocab.tokens[id];
        if (token.length === 1) {
          if (!text) start = f;
          text += token;
          last = f;
        }
      }
    }
    prev = id;
  }
  flush();
  return words;
}

/** Letters of the words, with the delimiter between words, as vocab ids. Unknown letters are dropped. */
export function targetsFor(words: string[], vocab: Vocab): { ids: number[]; wordOf: number[] } {
  const ids: number[] = [];
  const wordOf: number[] = [];
  words.forEach((word, w) => {
    if (w > 0) {
      ids.push(vocab.delimiter);
      wordOf.push(-1);
    }
    for (const ch of word) {
      const id = vocab.index.get(ch);
      if (id !== undefined) {
        ids.push(id);
        wordOf.push(w);
      }
    }
  });
  return { ids, wordOf };
}

export interface WordSpan {
  startFrame: number;
  endFrame: number;
  /** Mean over the word's frames of (forced log-prob − best log-prob): 0 is a perfect fit, very negative is poor. */
  fit: number;
}

/**
 * Viterbi alignment of known text over the frames (CTC topology: blanks between letters,
 * repeats need a blank). Returns each word's frame span and how well the audio fits it.
 * Null when the text cannot fit (more letters than frames).
 */
export function forcedAlign(lp: LogProbs, vocab: Vocab, words: string[]): WordSpan[] | null {
  const { ids, wordOf } = targetsFor(words, vocab);
  const L = ids.length;
  const S = 2 * L + 1;
  const T = lp.frames;
  if (L === 0 || T < L) return null;
  const label = (s: number) => (s % 2 === 0 ? vocab.blank : ids[(s - 1) >> 1]);
  const NEG = -Infinity;
  let prev = new Float64Array(S).fill(NEG);
  let cur = new Float64Array(S).fill(NEG);
  const back = new Int8Array(T * S);
  prev[0] = lp.data[label(0)];
  prev[1] = lp.data[label(1)];
  for (let t = 1; t < T; t++) {
    const row = t * lp.vocab;
    for (let s = 0; s < S; s++) {
      let best = prev[s];
      let from = 0;
      if (s >= 1 && prev[s - 1] > best) {
        best = prev[s - 1];
        from = 1;
      }
      if (s >= 2 && s % 2 === 1 && label(s) !== label(s - 2) && prev[s - 2] > best) {
        best = prev[s - 2];
        from = 2;
      }
      cur[s] = best === NEG ? NEG : best + lp.data[row + label(s)];
      back[t * S + s] = from;
    }
    [prev, cur] = [cur, prev];
  }
  let s = prev[S - 1] >= prev[S - 2] ? S - 1 : S - 2;
  if (prev[s] === NEG) return null;

  const stateAt = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) {
    stateAt[t] = s;
    if (t > 0) s -= back[t * S + s];
  }

  const spans: WordSpan[] = words.map(() => ({ startFrame: -1, endFrame: -1, fit: 0 }));
  const fitSum = new Float64Array(words.length);
  const fitCount = new Int32Array(words.length);
  for (let t = 0; t < T; t++) {
    const st = stateAt[t];
    if (st % 2 === 0) continue;
    const w = wordOf[(st - 1) >> 1];
    if (w < 0) continue;
    const span = spans[w];
    if (span.startFrame < 0) span.startFrame = t;
    span.endFrame = t + 1;
    const row = t * lp.vocab;
    fitSum[w] += lp.data[row + label(st)] - lp.data[row + argmaxRow(lp, t)];
    fitCount[w]++;
  }
  spans.forEach((span, w) => (span.fit = fitCount[w] ? fitSum[w] / fitCount[w] : -Infinity));
  return spans;
}
