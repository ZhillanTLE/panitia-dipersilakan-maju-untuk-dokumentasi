import type { CardWord, Confidence, Fluency, Insertion, WordResult } from '../types';

// Deterministic scoring engine for the web prototype: word alignment, text-level
// substitution check, decision table and fluency (CLAUDE.md slow-path steps 6, 8, 9, 10).
// No randomness. Changing any output here means bumping ENGINE_VERSION.
export const ENGINE_VERSION = 'scoring-web@0.2';

export interface HeardToken {
  text: string;
  /** Milliseconds from the start of the take when the word was first heard. */
  t_ms: number;
}

const GAP = 0.9;
const LONG_PAUSE_MS = 2000;
const NEAR = 0.75;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

const VOICING: [string, string][] = [
  ['b', 'p'],
  ['d', 't'],
  ['g', 'k'],
];
const VOWEL = /[aiueo]/;

/**
 * Rule-generated misreadings of a word: b/p, d/t, g/k swaps, ng/ny → n, final ai/au
 * simplified, and one letter dropped from a consonant cluster.
 */
export function misreadings(word: string): Set<string> {
  const out = new Set<string>();
  for (let k = 0; k < word.length; k++) {
    for (const [x, y] of VOICING) {
      if (word[k] === x) out.add(word.slice(0, k) + y + word.slice(k + 1));
      if (word[k] === y) out.add(word.slice(0, k) + x + word.slice(k + 1));
    }
  }
  for (const digraph of ['ng', 'ny']) {
    for (let k = word.indexOf(digraph); k !== -1; k = word.indexOf(digraph, k + 1)) {
      out.add(word.slice(0, k) + 'n' + word.slice(k + 2));
    }
  }
  if (word.endsWith('ai')) out.add(word.slice(0, -2) + 'e');
  if (word.endsWith('au')) out.add(word.slice(0, -2) + 'o');
  for (let k = 0; k < word.length - 1; k++) {
    if (!VOWEL.test(word[k]) && !VOWEL.test(word[k + 1])) {
      out.add(word.slice(0, k) + word.slice(k + 1));
      out.add(word.slice(0, k + 1) + word.slice(k + 2));
    }
  }
  out.delete(word);
  return out;
}

// Fillers are never a reading of a card word; they are always insertions.
const FILLERS = new Set(['e', 'ee', 'eee', 'eh', 'ehm', 'em', 'emm', 'hm', 'hmm', 'ah', 'aa', 'anu']);
const JOIN_PENALTY = 0.05;

interface CostModel {
  sub(expected: string, heard: string): number;
  insert(heard: string): number;
}

/**
 * Scoring: a very different word costs more than an insertion, so stray words stay
 * insertions instead of pushing card words out of place.
 */
const SCORING: CostModel = {
  sub(expected, heard) {
    if (FILLERS.has(heard)) return 2;
    const sim = similarity(expected, heard);
    return sim >= 0.5 ? 1 - sim : 1.2;
  },
  insert: () => GAP,
};

/**
 * Live highlight: a heard word is taken as the reader's attempt at the next card word,
 * even when the recognizer gets it wrong, so the highlight keeps moving. Fillers are
 * skipped almost for free. UI only; it never feeds a score (CLAUDE.md rule 4).
 */
const TRACKING: CostModel = {
  sub(expected, heard) {
    if (FILLERS.has(heard)) return 2;
    if (expected === heard) return 0;
    const sim = similarity(expected, heard);
    return sim >= 0.5 ? (1 - sim) * 0.8 : 0.75;
  },
  insert: (heard) => (FILLERS.has(heard) ? 0.1 : GAP),
};

/**
 * Recognizers sometimes join two words ("di belakang" → "dibelakang") or split one
 * ("pisang" → "pi sang"). A close match across the word boundary is allowed for a
 * small penalty; anything looser is not a join or split.
 */
function joinCost(a: string, b: string): number {
  const sim = similarity(a, b);
  return sim >= NEAR ? 1 - sim + JOIN_PENALTY : Infinity;
}

export type AlignOp =
  | { kind: 'match'; e: number; h: number }
  /** Two card words heard as one token. */
  | { kind: 'joined'; e: number; h: number }
  /** One card word heard as two tokens. */
  | { kind: 'split'; e: number; h: number }
  | { kind: 'omit'; e: number }
  | { kind: 'insert'; h: number };

function costTable(expected: string[], heard: string[], free: ReadonlySet<number>, model: CostModel): number[][] {
  const n = expected.length;
  const m = heard.length;
  const omit = (i: number) => (free.has(i) ? 0 : GAP);
  const D = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) D[i][0] = D[i - 1][0] + omit(i - 1);
  for (let j = 1; j <= m; j++) D[0][j] = D[0][j - 1] + model.insert(heard[j - 1]);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = Math.min(
        D[i - 1][j - 1] + model.sub(expected[i - 1], heard[j - 1]),
        D[i - 1][j] + omit(i - 1),
        D[i][j - 1] + model.insert(heard[j - 1]),
      );
      if (i >= 2) best = Math.min(best, D[i - 2][j - 1] + joinCost(expected[i - 2] + expected[i - 1], heard[j - 1]));
      if (j >= 2) best = Math.min(best, D[i - 1][j - 2] + joinCost(expected[i - 1], heard[j - 2] + heard[j - 1]));
      D[i][j] = best;
    }
  }
  return D;
}

/**
 * Global alignment of heard words to card words. `free` marks card words the teacher
 * supplied: skipping them costs nothing.
 */
export function align(expected: string[], heard: string[], free: ReadonlySet<number> = new Set()): AlignOp[] {
  const D = costTable(expected, heard, free, SCORING);
  const ops: AlignOp[] = [];
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  let i = expected.length;
  let j = heard.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && eq(D[i][j], D[i - 1][j - 1] + SCORING.sub(expected[i - 1], heard[j - 1]))) {
      ops.push({ kind: 'match', e: i - 1, h: j - 1 });
      i--;
      j--;
    } else if (i >= 2 && j > 0 && eq(D[i][j], D[i - 2][j - 1] + joinCost(expected[i - 2] + expected[i - 1], heard[j - 1]))) {
      ops.push({ kind: 'joined', e: i - 2, h: j - 1 });
      i -= 2;
      j--;
    } else if (i > 0 && j >= 2 && eq(D[i][j], D[i - 1][j - 2] + joinCost(expected[i - 1], heard[j - 2] + heard[j - 1]))) {
      ops.push({ kind: 'split', e: i - 1, h: j - 2 });
      i--;
      j -= 2;
    } else if (i > 0 && eq(D[i][j], D[i - 1][j] + (free.has(i - 1) ? 0 : GAP))) {
      ops.push({ kind: 'omit', e: i - 1 });
      i--;
    } else {
      ops.push({ kind: 'insert', h: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

/**
 * Live cursor for the highlight (fast path): how many card words the heard prefix covers.
 * On a tie it keeps the smaller position, so the cursor never runs ahead of the reader.
 * UI only. It never feeds a score (CLAUDE.md rule 4).
 */
export function liveCursor(expected: string[], heard: string[], free: ReadonlySet<number> = new Set()): number {
  let best = 0;
  if (heard.length) {
    const D = costTable(expected, heard, free, TRACKING);
    const m = heard.length;
    for (let i = 1; i <= expected.length; i++) {
      if (D[i][m] < D[best][m] - 1e-9) best = i;
    }
  }
  while (best < expected.length && free.has(best)) best++;
  return best;
}

function decide(word: CardWord, heard: HeardToken, heardNorm: string): WordResult {
  const base = { i: word.i, expected: word.text, heard: heard.text, start_ms: heard.t_ms };
  if (heardNorm === word.norm) return { ...base, status: 'correct', confidence: 'high' };
  if (misreadings(word.norm).has(heardNorm)) return { ...base, status: 'substituted', confidence: 'medium' };
  const sim = similarity(word.norm, heardNorm);
  if (sim >= NEAR) return { ...base, status: 'uncertain', confidence: 'low' };
  const confidence: Confidence = sim < 0.4 ? 'high' : 'medium';
  return { ...base, status: 'substituted', confidence };
}

/** A heard fragment that starts the next word, or is close to it, before the word is read correctly. */
function isAttemptAt(heard: string, target: string): boolean {
  return (heard.length >= 2 && target.startsWith(heard)) || similarity(heard, target) >= 0.5;
}

export interface ScoreInput {
  words: CardWord[];
  heard: HeardToken[];
  supplied: ReadonlySet<number>;
}

export interface ScoreOutput {
  words: WordResult[];
  insertions: Insertion[];
  fluency: Fluency;
}

export function scoreTake({ words, heard, supplied }: ScoreInput): ScoreOutput {
  const tokens = heard.map((h) => ({ ...h, norm: normalize(h.text) })).filter((h) => h.norm);
  const ops = align(
    words.map((w) => w.norm),
    tokens.map((t) => t.norm),
    supplied,
  );

  const results: WordResult[] = words.map((w) => ({ i: w.i, expected: w.text, status: 'omitted', confidence: 'medium' }));
  const insertions: Insertion[] = [];
  const long_pauses: Fluency['long_pauses'] = [];
  let lastExpected = -1;
  let lastHeardAt: number | null = null;

  for (const op of ops) {
    if (op.kind === 'omit') {
      lastExpected = op.e;
      continue;
    }
    const token = tokens[op.h];
    if (lastHeardAt !== null && token.t_ms - lastHeardAt > LONG_PAUSE_MS) {
      long_pauses.push({ before_i: op.kind === 'insert' ? lastExpected + 1 : op.e, ms: token.t_ms - lastHeardAt });
    }
    lastHeardAt = op.kind === 'split' ? tokens[op.h + 1].t_ms : token.t_ms;
    if (op.kind === 'match') {
      lastExpected = op.e;
      results[op.e] = decide(words[op.e], token, token.norm);
    } else if (op.kind === 'joined') {
      // Both card words share the one token. An exact join is a recognizer quirk, not a misreading.
      const exact = token.norm === words[op.e].norm + words[op.e + 1].norm;
      for (const i of [op.e, op.e + 1]) {
        results[i] = {
          i,
          expected: words[i].text,
          heard: token.text,
          start_ms: token.t_ms,
          status: exact ? 'correct' : 'uncertain',
          confidence: exact ? 'medium' : 'low',
        };
      }
      lastExpected = op.e + 1;
    } else if (op.kind === 'split') {
      const second = tokens[op.h + 1];
      const joined = { text: `${token.text} ${second.text}`, t_ms: token.t_ms };
      results[op.e] = decide(words[op.e], joined, token.norm + second.norm);
      lastExpected = op.e;
    } else {
      insertions.push({ after_i: lastExpected, heard: token.text, start_ms: token.t_ms });
    }
  }

  for (const i of supplied) {
    if (results[i]) results[i] = { ...results[i], status: 'supplied', confidence: 'high' };
  }

  // Repeated words and self-corrections are not errors. The insertion stays listed as evidence.
  for (const ins of insertions) {
    const heardNorm = normalize(ins.heard);
    const prev = results[ins.after_i];
    const next = results[ins.after_i + 1];
    if (prev?.status === 'correct' && heardNorm === words[prev.i].norm) prev.status = 'repeated';
    else if (next?.status === 'correct' && heardNorm === words[next.i].norm) next.status = 'repeated';
    else if (next?.status === 'correct' && isAttemptAt(heardNorm, words[next.i].norm)) next.status = 'self_corrected';
  }

  return { words: results, insertions, fluency: fluency(results, tokens, long_pauses) };
}

const NOT_ERRORS = new Set(['correct', 'repeated', 'self_corrected']);

function fluency(results: WordResult[], tokens: HeardToken[], long_pauses: Fluency['long_pauses']): Fluency {
  const words_correct = results.filter((r) => NOT_ERRORS.has(r.status)).length;
  if (tokens.length < 2) return { reading_time_s: null, words_correct, wcpm: null, long_pauses };
  // Word end times are not known in the browser; half a second stands in for the last word.
  const reading_time_s = round1((tokens[tokens.length - 1].t_ms - tokens[0].t_ms) / 1000 + 0.5);
  return { reading_time_s, words_correct, wcpm: round1((words_correct / reading_time_s) * 60), long_pauses };
}

/** Teacher-marked take with no recognizer: every word starts as read, apart from words the teacher supplied. */
export function manualTake(words: CardWord[], supplied: ReadonlySet<number>, wordTimes: Map<number, number>): ScoreOutput {
  const results: WordResult[] = words.map((w) =>
    supplied.has(w.i)
      ? { i: w.i, expected: w.text, status: 'supplied', start_ms: wordTimes.get(w.i) }
      : { i: w.i, expected: w.text, status: 'correct', start_ms: wordTimes.get(w.i) },
  );
  const times = [...wordTimes.values()].sort((a, b) => a - b);
  const words_correct = results.filter((r) => r.status === 'correct').length;
  if (times.length < 2) return { words: results, insertions: [], fluency: { reading_time_s: null, words_correct, wcpm: null, long_pauses: [] } };
  const reading_time_s = round1((times[times.length - 1] - times[0]) / 1000 + 0.5);
  return {
    words: results,
    insertions: [],
    fluency: { reading_time_s, words_correct, wcpm: round1((words_correct / reading_time_s) * 60), long_pauses: [] },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
