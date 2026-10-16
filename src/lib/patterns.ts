import rules from '../content/patterns.json';
import { normalize } from './scoring';
import { syllableCount } from './syllables';

// Error patterns: which letter, syllable or word shapes a misread word has. Fixed rules, no model.
// The rules live in content/patterns.json and are shared with the planner (planner/patterns.py);
// patterns.cases.json holds the cases both implementations must agree on. A pattern describes
// what was read, never why it was read that way.

export type PatternId = 'letter_confusion' | 'closed_syllable' | 'digraph_cluster' | 'long_word' | 'affixed_word';

export const PATTERN_IDS = rules.patterns.map((p) => p.id) as PatternId[];
export const PATTERN_LABEL = Object.fromEntries(rules.patterns.map((p) => [p.id, p.label])) as Record<PatternId, string>;

const VOWELS = new Set(rules.vowels);
const CONFUSABLE = new Set(rules.confusable.flatMap(([a, b]) => [`${a}${b}`, `${b}${a}`]));
const LETTER_NAMES = rules.letterNames as Record<string, string>;
const CLUSTERS = new Set(rules.clusters);
const NOT_AFFIXED = new Set(rules.notAffixed);

/** Letters, with ng, ny, sy and kh kept as one consonant. */
function units(word: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < word.length;) {
    const two = word.slice(k, k + 2);
    if (rules.digraphs.includes(two)) {
      out.push(two);
      k += 2;
    } else {
      out.push(word[k]);
      k += 1;
    }
  }
  return out;
}

/** A syllable that ends in a consonant: ban, sar, tum, bin-tang, dom-ba. */
export function hasClosedSyllable(word: string): boolean {
  const us = units(word);
  const vowels = us.flatMap((u, k) => (VOWELS.has(u) ? [k] : []));
  if (us.length < 2 || !vowels.length) return false;
  if (!VOWELS.has(us[us.length - 1])) return true;
  for (let k = 0; k + 1 < vowels.length; k++) {
    const run = us.slice(vowels[k] + 1, vowels[k + 1]);
    if (run.length > 2 || (run.length === 2 && !CLUSTERS.has(run[0] + run[1]))) return true;
  }
  return false;
}

export function hasDigraphOrCluster(word: string): boolean {
  if (rules.digraphs.some((d) => word.includes(d))) return true;
  for (let k = 0; k + 1 < word.length; k++) if (CLUSTERS.has(word.slice(k, k + 2))) return true;
  return false;
}

/** me-, ber-, -kan, -an and the rest, only when what is left is long enough to be a root word. */
export function isAffixed(word: string): boolean {
  if (NOT_AFFIXED.has(word)) return false;
  return (
    rules.prefixes.some((a) => word.startsWith(a.affix) && word.length - a.affix.length >= a.minStem) ||
    rules.suffixes.some((a) => word.endsWith(a.affix) && word.length - a.affix.length >= a.minStem)
  );
}

/** Same length, and every letter that differs is one of the fixed similar pairs (b-d, p-q, m-n...). */
export function letterConfusion(expected: string, heard: string | null | undefined): boolean {
  if (!heard) return false;
  const e = normalize(expected);
  let h = normalize(heard);
  if (e.length === 1) h = LETTER_NAMES[h] ?? h;
  if (e.length !== h.length || e === h) return false;
  for (let k = 0; k < e.length; k++) if (e[k] !== h[k] && !CONFUSABLE.has(e[k] + h[k])) return false;
  return true;
}

/** Pattern ids for one misread word, in the fixed list order. */
export function classify(expected: string, heard?: string | null): PatternId[] {
  const word = normalize(expected);
  const hits: PatternId[] = [];
  if (letterConfusion(expected, heard)) hits.push('letter_confusion');
  if (word.length >= 2 && [...word].some((ch) => VOWELS.has(ch))) {
    if (hasClosedSyllable(word)) hits.push('closed_syllable');
    if (hasDigraphOrCluster(word)) hits.push('digraph_cluster');
    if (syllableCount(word) >= rules.longWordSyllables) hits.push('long_word');
    if (isAffixed(word)) hits.push('affixed_word');
  }
  return hits;
}
