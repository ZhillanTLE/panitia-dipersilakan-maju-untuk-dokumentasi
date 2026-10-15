import { describe, expect, it } from 'vitest';
import type { CardLevel, Take, WordStatus } from '../types';
import { cardFor, cardWords } from './cards';
import { cardOutcome, nextCard, suggestLevel } from './rubric';

let clock = 0;

function take(level: CardLevel, errors: number, edits: Record<number, WordStatus> = {}): Take {
  const card = cardFor(level);
  const words = cardWords(card).map((w, k) => ({
    i: w.i,
    expected: w.text,
    status: (k < errors ? 'substituted' : 'correct') as WordStatus,
  }));
  return {
    take_id: `t${clock}`,
    session_id: 's',
    student_ref: 'K2-01',
    card: { id: card.id, version: card.version, level },
    source: 'manual',
    simulated: false,
    created_at: clock++,
    quality: { status: 'not_measured' },
    words,
    insertions: [],
    fluency: { reading_time_s: null, words_correct: 0, wcpm: null, long_pauses: [] },
    events: [],
    versions: { card: 1, model: 'manual', engine: 'test', rubric: 'tarl-id@1' },
    audio: { stored: false },
    teacher: { edits },
  };
}

describe('cardOutcome', () => {
  it('needs 36 of 39 words on the paragraph card', () => {
    expect(cardOutcome(take('paragraf', 3))).toMatchObject({ total: 39, needed: 36, correct: 36, passed: true });
    expect(cardOutcome(take('paragraf', 4))).toMatchObject({ correct: 35, passed: false });
  });

  it('needs 8 of 10 on the word card', () => {
    expect(cardOutcome(take('kata', 2)).passed).toBe(true);
    expect(cardOutcome(take('kata', 3)).passed).toBe(false);
  });

  it('applies teacher edits, but can score the engine output alone', () => {
    const t = take('kata', 3, { 0: 'correct' });
    expect(cardOutcome(t).passed).toBe(true);
    expect(cardOutcome(t, false).passed).toBe(false);
  });

  it('counts uncertain words as errors until the teacher resolves them', () => {
    const t = take('kata', 0, { 0: 'uncertain', 1: 'uncertain', 2: 'uncertain' });
    expect(cardOutcome(t)).toMatchObject({ unresolved: 3, passed: false });
  });
});

describe('nextCard', () => {
  it('stops after a pass and steps down after a fail', () => {
    expect(nextCard('paragraf', true)).toBeNull();
    expect(nextCard('paragraf', false)).toBe('kalimat');
    expect(nextCard('suku_kata', false)).toBe('huruf');
    expect(nextCard('huruf', false)).toBeNull();
  });
});

describe('suggestLevel', () => {
  it('uses the highest card passed', () => {
    expect(suggestLevel([take('paragraf', 9), take('kalimat', 1)])).toMatchObject({
      level: 'kalimat',
      rule: 'tarl-id@1 R-KAL',
    });
  });

  it('gives pemula when every card down to huruf is failed', () => {
    const takes = (['paragraf', 'kalimat', 'kata', 'suku_kata', 'huruf'] as CardLevel[]).map((l) => take(l, 9));
    expect(suggestLevel(takes)).toMatchObject({ level: 'pemula', rule: 'tarl-id@1 R-PEM' });
  });

  it('asks for the next card when the session stopped early', () => {
    expect(suggestLevel([take('paragraf', 9)])).toMatchObject({ level: null, missing: 'kalimat' });
    expect(suggestLevel([])).toMatchObject({ level: null, missing: 'paragraf' });
  });

  it('uses the latest take of a repeated card', () => {
    expect(suggestLevel([take('kata', 9), take('kata', 0)]).level).toBe('kata');
  });
});
