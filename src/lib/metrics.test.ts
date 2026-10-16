import { describe, expect, it } from 'vitest';
import cases from './patterns.cases.json';
import type { CardLevel, Session, Take, WordResult } from '../types';
import { cardFor, cardWords } from './cards';
import { cardMetrics, confirmedWords, earlierResults, groupPatternCounts, levelTake, patternHits, patternTakes } from './metrics';
import { classify, PATTERN_IDS } from './patterns';
import { syllableCount } from './syllables';
import { normalize } from './scoring';

describe('patterns, the cases the planner must agree on', () => {
  for (const c of cases.classify) {
    it(`${c.expected} heard as ${c.heard ?? 'nothing'}`, () => {
      expect(classify(c.expected, c.heard)).toEqual(c.patterns);
    });
  }
  for (const c of cases.syllables) {
    it(`${c.word} has ${c.count} syllables`, () => expect(syllableCount(normalize(c.word))).toBe(c.count));
  }
  it('only ever returns ids from the fixed list', () => {
    for (const c of cases.classify) for (const id of classify(c.expected, c.heard)) expect(PATTERN_IDS).toContain(id);
  });
});

let clock = 0;

function take(level: CardLevel, change: Record<number, Partial<WordResult>> = {}, extra: Partial<Take> = {}): Take {
  const card = cardFor(level);
  const words: WordResult[] = cardWords(card).map((w) => ({ i: w.i, expected: w.text, status: 'correct', heard: w.text, ...change[w.i] }));
  return {
    take_id: `t${clock}`,
    session_id: 's1',
    student_ref: 'K2-03',
    card: { id: card.id, version: card.version, level },
    source: 'online',
    simulated: false,
    created_at: clock++,
    quality: { status: 'ok' },
    words,
    insertions: [],
    fluency: { reading_time_s: 30, words_correct: 0, wcpm: null, long_pauses: [] },
    events: [],
    versions: { card: 1, model: 'test', engine: 'test', rubric: 'tarl-id@1' },
    audio: { stored: false },
    teacher: { edits: {} },
    ...extra,
  };
}

describe('cardMetrics', () => {
  it('counts self-corrected as correct and repeated as no error', () => {
    const t = take('kata', { 0: { status: 'self_corrected' }, 1: { status: 'repeated' }, 2: { status: 'substituted', heard: 'doba' } });
    const m = cardMetrics(t);
    expect(m.accuracy).toEqual({ correct: 9, attempted: 10 });
    expect(m.selfCorrections).toBe(1);
    expect(m.errorCounts).toEqual({ substituted: 1, omitted: 0, teacherRead: 0, uncertain: 0 });
  });

  it('counts correct units per minute in the card unit', () => {
    const m = cardMetrics(take('suku_kata', { 0: { status: 'omitted' } }));
    expect(m.unit).toBe('suku_kata');
    expect(m.correctUnitsPerMinute).toBe(18); // 9 syllables in 30 seconds
    expect(
      cardMetrics(take('kata', {}, { fluency: { reading_time_s: null, words_correct: 0, wcpm: null, long_pauses: [] } })).correctUnitsPerMinute,
    ).toBeNull();
  });

  it('follows the teacher edits, not the engine', () => {
    const t = take('kata', { 0: { status: 'uncertain' } });
    expect(cardMetrics(t).confidence.unresolved).toBe(1);
    const edited = { ...t, teacher: { edits: { 0: 'correct' as const } } };
    const m = cardMetrics(edited);
    expect(m.accuracy.correct).toBe(10);
    expect(m.confidence).toMatchObject({ unresolved: 0, teacherCorrections: 1, uncertainWordShare: 0.1 });
  });

  it('counts only pauses over three seconds, with the word they came before', () => {
    const t = take(
      'kata',
      {},
      {
        fluency: {
          reading_time_s: 30,
          words_correct: 10,
          wcpm: 20,
          long_pauses: [
            { before_i: 3, ms: 2500 },
            { before_i: 4, ms: 3400 },
          ],
        },
      },
    );
    expect(cardMetrics(t).longPauses).toEqual({ count: 1, before: ['gurun'] });
  });

  it('counts comprehension on paragraf cards only, from the questions the teacher tapped', () => {
    const p = take('paragraf', {}, { teacher: { edits: {}, comprehension: [true, false, null] } });
    expect(cardMetrics(p).comprehension).toEqual({ correct: 1, asked: 2 });
    expect(cardMetrics(take('paragraf')).comprehension).toBeNull();
    expect(cardMetrics(take('kata', {}, { teacher: { edits: {}, comprehension: [true] } })).comprehension).toBeNull();
  });
});

describe('patternHits', () => {
  it('groups misread words by rule with up to three examples', () => {
    // Kata dari gurun: mawar, rubah, domba, bintang, gurun, sumur, pilot, raja, pasir, lampu
    const t = take('kata', {
      1: { status: 'substituted', heard: 'rudah' },
      3: { status: 'substituted', heard: 'bintan' },
      4: { status: 'omitted', heard: 'gu' },
      8: { status: 'substituted', heard: 'pasi' },
      9: { status: 'substituted', heard: 'lapu' },
    });
    const hits = patternHits([t]);
    expect(hits.map((h) => [h.id, h.count])).toEqual([
      ['letter_confusion', 1],
      ['closed_syllable', 5],
      ['digraph_cluster', 1],
    ]);
    expect(hits[1].examples.map((e) => [e.word, e.heard])).toEqual([
      ['rubah', 'rudah'],
      ['bintang', 'bintan'],
      ['gurun', null],
    ]);
  });

  it('ignores words that are not errors', () => {
    expect(patternHits([take('kata', { 3: { status: 'self_corrected', heard: 'bintan' } })])).toEqual([]);
  });
});

describe('confirmedWords and levelTake', () => {
  it('counts every word that is no longer uncertain', () => {
    expect(confirmedWords([take('kata', { 0: { status: 'uncertain' }, 1: { status: 'uncertain' } })])).toBe(8);
  });
  it('uses the letter card for pemula and the newest take', () => {
    const a = take('huruf');
    const b = take('huruf');
    expect(levelTake([a, b, take('kata')], 'pemula')?.take_id).toBe(b.take_id);
  });
});

describe('patternTakes', () => {
  it('uses only the card at the child level once there is one', () => {
    const par = take('paragraf', { 3: { status: 'omitted' } });
    const hur = take('huruf', { 3: { status: 'substituted', heard: 'd' } });
    expect(patternTakes([par, hur], 'pemula')).toEqual([hur]);
    expect(patternHits(patternTakes([par, hur], 'pemula')).map((h) => h.id)).toEqual(['letter_confusion']);
    expect(patternTakes([par, hur], null)).toEqual([par, hur]);
  });
});

describe('earlierResults', () => {
  it('lists only this child, oldest first, and leaves simulated readings out', () => {
    const t1 = take('kata');
    const t2 = take('suku_kata');
    const session = (id: string, ref: string, at: number, level: 'kata' | 'suku_kata', ids: string[], simulated = false): Session => ({
      session_id: id,
      student_ref: ref,
      started_at: at,
      simulated,
      take_ids: ids,
      suggestion: { level, rule: 'r', status: 'confirmed', confirmed: { level, rule: 'r', at } },
    });
    const sessions = [
      session('b', 'K2-03', 20, 'kata', [t1.take_id]),
      session('a', 'K2-03', 10, 'suku_kata', [t2.take_id]),
      session('c', 'K2-04', 5, 'kata', []),
      session('d', 'K2-03', 15, 'kata', [], true),
    ];
    const out = earlierResults('K2-03', sessions, { [t1.take_id]: t1, [t2.take_id]: t2 }, 100);
    expect(out.map((r) => [r.session_id, r.level, r.unit, r.correctUnitsPerMinute])).toEqual([
      ['a', 'suku_kata', 'suku_kata', 20],
      ['b', 'kata', 'kata', 20],
    ]);
  });
});

describe('groupPatternCounts', () => {
  it('counts children, not words', () => {
    const one = take('kata', { 4: { status: 'omitted' }, 5: { status: 'omitted' } });
    const two = take('kata', { 4: { status: 'omitted' } });
    const three = take('kata');
    expect(groupPatternCounts([[one], [two], [three]])).toEqual([{ id: 'closed_syllable', children: 2 }]);
  });
});
