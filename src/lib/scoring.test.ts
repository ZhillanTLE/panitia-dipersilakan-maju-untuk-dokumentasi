import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { cardWords } from './cards';
import { liveCursor, misreadings, normalize, scoreTake, type HeardToken } from './scoring';

const card: Card = {
  id: 'TEST-01',
  version: 1,
  level: 'kalimat',
  title: 'Test',
  layout: 'lines',
  blocks: ['Ibu pergi ke pasar.', 'Rumah nenek dekat sawah.'],
};
const words = cardWords(card);
const norms = words.map((w) => w.norm);

function heard(text: string, stepMs = 500): HeardToken[] {
  return text.split(' ').map((t, k) => ({ text: t, t_ms: 400 + k * stepMs }));
}

function statuses(text: string, supplied: number[] = []) {
  return scoreTake({ words, heard: heard(text), supplied: new Set(supplied) }).words.map((w) => w.status);
}

describe('normalize', () => {
  it('strips case, punctuation and accents', () => {
    expect(normalize('Pasar.')).toBe('pasar');
    expect(normalize('“Ibu,')).toBe('ibu');
    expect(normalize('café')).toBe('cafe');
  });
});

describe('misreadings', () => {
  it('generates voicing swaps, digraph and cluster simplifications', () => {
    expect(misreadings('pergi').has('bergi')).toBe(true);
    expect(misreadings('dekat').has('tekat')).toBe(true);
    expect(misreadings('pisang').has('pisan')).toBe(true);
    expect(misreadings('nyanyi').has('nanyi')).toBe(true);
    expect(misreadings('pantai').has('pante')).toBe(true);
    expect(misreadings('putri').has('puti')).toBe(true);
    expect(misreadings('pergi').has('pergi')).toBe(false);
  });
});

describe('scoreTake', () => {
  it('marks a clean reading as all correct', () => {
    expect(statuses('ibu pergi ke pasar rumah nenek dekat sawah')).toEqual(Array(8).fill('correct'));
  });

  it('flags a rule-based misreading as substituted', () => {
    const result = scoreTake({ words, heard: heard('ibu bergi ke pasar rumah nenek dekat sawah'), supplied: new Set() });
    expect(result.words[1]).toMatchObject({ status: 'substituted', heard: 'bergi', confidence: 'medium' });
  });

  it('flags a close but unexplained difference for review', () => {
    expect(statuses('ibu pergi ke pasar rumah nenek dekat sawan')[7]).toBe('uncertain');
  });

  it('marks a skipped word as omitted', () => {
    expect(statuses('ibu pergi pasar rumah nenek dekat sawah')[2]).toBe('omitted');
  });

  it('marks unread trailing words as omitted', () => {
    expect(statuses('ibu pergi ke pasar').slice(4)).toEqual(Array(4).fill('omitted'));
  });

  it('treats a repeated word as repeated, not an error', () => {
    const result = scoreTake({ words, heard: heard('ibu pergi ke pasar rumah rumah nenek dekat sawah'), supplied: new Set() });
    expect(result.words[4].status).toBe('repeated');
    expect(result.insertions).toHaveLength(1);
  });

  it('treats a wrong start fixed by the reader as self_corrected', () => {
    expect(statuses('ibu bergi pergi ke pasar rumah nenek dekat sawah')[1]).toBe('self_corrected');
  });

  it('keeps fillers as insertions without moving words', () => {
    const result = scoreTake({ words, heard: heard('ibu eh pergi ke pasar rumah nenek dekat sawah'), supplied: new Set() });
    expect(result.words.every((w) => w.status === 'correct')).toBe(true);
    expect(result.insertions).toEqual([{ after_i: 0, heard: 'eh', start_ms: 900 }]);
  });

  it('accepts two words the recognizer joined into one', () => {
    const result = scoreTake({ words, heard: heard('ibu pergi kepasar rumah nenek dekat sawah'), supplied: new Set() });
    expect(result.words.map((w) => w.status)).toEqual(Array(8).fill('correct'));
    expect(result.words[2]).toMatchObject({ heard: 'kepasar', confidence: 'medium' });
    expect(result.insertions).toEqual([]);
  });

  it('accepts one word the recognizer split in two', () => {
    const result = scoreTake({ words, heard: heard('ibu per gi ke pasar rumah nenek dekat sawah'), supplied: new Set() });
    expect(result.words.map((w) => w.status)).toEqual(Array(8).fill('correct'));
    expect(result.words[1].heard).toBe('per gi');
  });

  it('does not treat a repeated word as a split', () => {
    const result = scoreTake({ words, heard: heard('ibu pergi ke pasar rumah rumah nenek dekat sawah'), supplied: new Set() });
    expect(result.words[4].status).toBe('repeated');
  });

  it('marks words the teacher supplied, whether or not the child said them', () => {
    expect(statuses('ibu pergi ke pasar rumah nenek sawah', [6])[6]).toBe('supplied');
    expect(statuses('ibu pergi ke pasar rumah nenek dekat sawah', [6])[6]).toBe('supplied');
  });

  it('computes words correct per minute and long pauses', () => {
    const tokens = heard('ibu pergi ke pasar rumah nenek dekat sawah', 500);
    tokens[4] = { ...tokens[4], t_ms: tokens[3].t_ms + 2600 };
    for (let k = 5; k < tokens.length; k++) tokens[k] = { ...tokens[k], t_ms: tokens[k - 1].t_ms + 500 };
    const { fluency } = scoreTake({ words, heard: tokens, supplied: new Set() });
    expect(fluency.words_correct).toBe(8);
    expect(fluency.long_pauses).toEqual([{ before_i: 4, ms: 2600 }]);
    expect(fluency.reading_time_s).toBe(6.1);
    expect(fluency.wcpm).toBe(78.7);
  });

  it('is deterministic', () => {
    const a = scoreTake({ words, heard: heard('ibu bergi pasar eh rumah nenek dekat'), supplied: new Set() });
    const b = scoreTake({ words, heard: heard('ibu bergi pasar eh rumah nenek dekat'), supplied: new Set() });
    expect(a).toEqual(b);
  });
});

describe('liveCursor', () => {
  it('advances with each word read', () => {
    expect(liveCursor(norms, [])).toBe(0);
    expect(liveCursor(norms, ['ibu'])).toBe(1);
    expect(liveCursor(norms, ['ibu', 'pergi', 'ke'])).toBe(3);
  });

  it('does not advance on a filler', () => {
    expect(liveCursor(norms, ['ibu', 'eh'])).toBe(1);
  });

  it('keeps moving when a word is skipped, then lines up again', () => {
    expect(liveCursor(norms, ['ibu', 'pergi', 'pasar'])).toBe(3);
    expect(liveCursor(norms, ['ibu', 'pergi', 'pasar', 'rumah'])).toBe(5);
  });

  it('keeps moving when the recognizer mishears every word', () => {
    expect(liveCursor(norms, ['ibu', 'berkata', 'kemana', 'lapar'])).toBe(4);
    expect(liveCursor(norms, ['ibu', 'berkata', 'kemana', 'lapar', 'rumah'])).toBe(5);
  });

  it('moves two words for a joined token', () => {
    expect(liveCursor(norms, ['ibu', 'pergi', 'kepasar'])).toBe(4);
  });

  it('steps over words the teacher supplied', () => {
    expect(liveCursor(norms, ['ibu', 'pergi'], new Set([2]))).toBe(3);
  });
});
