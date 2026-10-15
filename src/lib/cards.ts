import bank from '../content/cards.json';
import type { Card, CardLevel, CardWord } from '../types';
import { normalize } from './scoring';

export const CARDS = bank.cards as Card[];
export const CARD_BANK_VERSION = `${bank.bank}@${bank.version}`;

export function cardFor(level: CardLevel): Card {
  const card = CARDS.find((c) => c.level === level);
  if (!card) throw new Error(`No card for level ${level}`);
  return card;
}

export function cardById(id: string): Card | undefined {
  return CARDS.find((c) => c.id === id);
}

const SENTENCE_END = /[.!?]["”’']?$/;

/** Splits a card into words with global indices. Grid cells are single items in one sentence. */
export function cardWords(card: Card): CardWord[] {
  const out: CardWord[] = [];
  let sentence = 0;
  card.blocks.forEach((block, b) => {
    const tokens = card.layout === 'grid' ? [block] : block.split(/\s+/).filter(Boolean);
    for (const text of tokens) {
      out.push({ i: out.length, text, norm: normalize(text), block: b, sentence });
      if (card.layout !== 'grid' && SENTENCE_END.test(text)) sentence++;
    }
  });
  return out;
}
