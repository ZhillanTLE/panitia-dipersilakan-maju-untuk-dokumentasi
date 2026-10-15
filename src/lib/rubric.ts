import rubric from '../content/rubric.json';
import type { CardLevel, ChildLevel, Take, WordStatus } from '../types';

interface Rubric {
  id: string;
  version: number;
  order: CardLevel[];
  start: CardLevel;
  error_statuses: WordStatus[];
  cards: Record<CardLevel, { rule: string; min_accuracy: number }>;
  beginner_rule: string;
}

export const RUBRIC = rubric as Rubric;
export const RUBRIC_VERSION = `${RUBRIC.id}@${RUBRIC.version}`;
/** Card levels from hardest to easiest. The assessment starts at the top and steps down. */
export const CARD_ORDER = RUBRIC.order;
/** Child levels from easiest to hardest, used for grouping. */
export const LEVEL_ORDER: ChildLevel[] = ['pemula', ...[...RUBRIC.order].reverse()];

const ERRORS: ReadonlySet<WordStatus> = new Set(RUBRIC.error_statuses);

export function isError(status: WordStatus): boolean {
  return ERRORS.has(status);
}

/** The teacher's edit if there is one, otherwise the engine's status. */
export function effectiveStatus(take: Take, i: number): WordStatus {
  return take.teacher.edits[i] ?? take.words[i].status;
}

export interface CardOutcome {
  level: CardLevel;
  rule: string;
  total: number;
  correct: number;
  needed: number;
  passed: boolean;
  unresolved: number;
}

/** Pass or fail for one card. `withTeacher: false` scores the engine output alone (provisional). */
export function cardOutcome(take: Take, withTeacher = true): CardOutcome {
  const statuses = take.words.map((w) => (withTeacher ? effectiveStatus(take, w.i) : w.status));
  const { rule, min_accuracy } = RUBRIC.cards[take.card.level];
  const total = statuses.length;
  const correct = statuses.filter((s) => !isError(s)).length;
  const needed = Math.ceil(min_accuracy * total - 1e-9);
  return {
    level: take.card.level,
    rule,
    total,
    correct,
    needed,
    passed: correct >= needed,
    unresolved: statuses.filter((s) => s === 'uncertain').length,
  };
}

/** Next card to try after this one: none after a pass, one step easier after a fail. */
export function nextCard(level: CardLevel, passed: boolean): CardLevel | null {
  if (passed) return null;
  return CARD_ORDER[CARD_ORDER.indexOf(level) + 1] ?? null;
}

export interface LevelSuggestion {
  level: ChildLevel | null;
  rule: string;
  /** The card that decided the level, if any. */
  decidedBy: CardOutcome | null;
  /** When no level can be set yet: the card to try next. */
  missing: CardLevel | null;
}

/** Highest card passed sets the level. Failing every card down to huruf means pemula. */
export function suggestLevel(takes: Take[], withTeacher = true): LevelSuggestion {
  const latest = new Map<CardLevel, Take>();
  for (const take of [...takes].sort((a, b) => a.created_at - b.created_at)) latest.set(take.card.level, take);

  for (const level of CARD_ORDER) {
    const take = latest.get(level);
    if (!take) continue;
    const outcome = cardOutcome(take, withTeacher);
    if (outcome.passed) return { level, rule: `${RUBRIC_VERSION} ${outcome.rule}`, decidedBy: outcome, missing: null };
  }
  if (latest.has('huruf')) {
    return { level: 'pemula', rule: `${RUBRIC_VERSION} ${RUBRIC.beginner_rule}`, decidedBy: null, missing: null };
  }
  const attempted = CARD_ORDER.filter((l) => latest.has(l));
  const lowest = attempted[attempted.length - 1];
  return {
    level: null,
    rule: RUBRIC_VERSION,
    decidedBy: null,
    missing: lowest ? nextCard(lowest, false) : RUBRIC.start,
  };
}
