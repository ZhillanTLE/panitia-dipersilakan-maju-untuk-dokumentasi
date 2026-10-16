import { cardById, cardFor } from './cards';
import { classify, PATTERN_IDS, type PatternId } from './patterns';
import { effectiveStatus, isError } from './rubric';
import type { CardLevel, ChildLevel, Quality, Session, Take, WordStatus } from '../types';

// Per-child reading metrics, computed by rules from the teacher-reviewed word statuses and the
// take's timings. Deterministic: no model writes or changes any of these numbers. Tinjau, Kelas
// and the planner sync all read them from here, so the teacher and the planner see the same values.

/** What a card counts: letters, syllables or words. Different units are never compared. */
export type Unit = 'huruf' | 'suku_kata' | 'kata';

export const CARD_UNIT: Record<CardLevel, Unit> = {
  huruf: 'huruf',
  suku_kata: 'suku_kata',
  kata: 'kata',
  kalimat: 'kata',
  paragraf: 'kata',
};

/** The card a child's metrics come from: the card at their level, or the letter card for pemula. */
export const LEVEL_CARD: Record<ChildLevel, CardLevel> = {
  pemula: 'huruf',
  huruf: 'huruf',
  suku_kata: 'suku_kata',
  kata: 'kata',
  kalimat: 'kalimat',
  paragraf: 'paragraf',
};

export const LEVEL_UNIT = (level: ChildLevel): Unit => CARD_UNIT[LEVEL_CARD[level]];

/** Pauses longer than this count as long pauses. */
export const LONG_PAUSE_MS = 3000;
/** At or above this share of words the engine was unsure of, the numbers carry a confidence flag. */
export const UNSURE_SHARE = 0.2;
export const MAX_EXAMPLES = 3;

export interface CardMetrics {
  take_id: string;
  level: CardLevel;
  unit: Unit;
  /** Self-corrected counts as correct; repeated is not an error. */
  accuracy: { correct: number; attempted: number };
  correctUnitsPerMinute: number | null;
  errorCounts: { substituted: number; omitted: number; teacherRead: number; uncertain: number };
  /** Pauses over three seconds, with the word each one came before. */
  longPauses: { count: number; before: string[] };
  selfCorrections: number;
  /** Paragraf cards only, once the teacher has tapped at least one answer. */
  comprehension: { correct: number; asked: number } | null;
  confidence: { uncertainWordShare: number; teacherCorrections: number; audioQuality: Quality['status']; unresolved: number };
}

export interface PatternExample {
  word: string;
  heard: string | null;
  status: WordStatus;
  take_id: string;
  i: number;
}

export interface PatternHit {
  id: PatternId;
  count: number;
  examples: PatternExample[];
}

export function cardMetrics(take: Take): CardMetrics {
  const statuses = take.words.map((w) => effectiveStatus(take, w.i));
  const count = (s: WordStatus) => statuses.filter((x) => x === s).length;
  const correct = statuses.filter((s) => !isError(s)).length;
  const seconds = take.fluency.reading_time_s;
  const engineUnsure = take.words.filter((w) => w.status === 'uncertain').length;
  const long = take.fluency.long_pauses.filter((p) => p.ms > LONG_PAUSE_MS);
  return {
    take_id: take.take_id,
    level: take.card.level,
    unit: CARD_UNIT[take.card.level],
    accuracy: { correct, attempted: statuses.length },
    correctUnitsPerMinute: seconds ? Math.round((correct / seconds) * 60) : null,
    errorCounts: { substituted: count('substituted'), omitted: count('omitted'), teacherRead: count('supplied'), uncertain: count('uncertain') },
    longPauses: { count: long.length, before: long.map((p) => take.words[p.before_i]?.expected).filter((w): w is string => Boolean(w)) },
    selfCorrections: count('self_corrected'),
    comprehension: comprehension(take),
    confidence: {
      uncertainWordShare: statuses.length ? Math.round((engineUnsure / statuses.length) * 100) / 100 : 0,
      teacherCorrections: Object.keys(take.teacher.edits).length,
      audioQuality: take.quality.status,
      unresolved: count('uncertain'),
    },
  };
}

export function questionsOf(take: Take): { q: string; a: string }[] {
  if (take.card.level !== 'paragraf') return [];
  return (cardById(take.card.id) ?? cardFor('paragraf')).questions ?? [];
}

function comprehension(take: Take): CardMetrics['comprehension'] {
  const asked = questionsOf(take)
    .map((_, k) => take.teacher.comprehension?.[k])
    .filter((x): x is boolean => typeof x === 'boolean');
  return asked.length ? { correct: asked.filter(Boolean).length, asked: asked.length } : null;
}

/** Every pattern the misread words hit across these cards, in the fixed list order, with up to three examples each. */
export function patternHits(takes: Take[]): PatternHit[] {
  const hits = new Map<PatternId, PatternHit>();
  for (const take of takes) {
    for (const w of take.words) {
      const status = effectiveStatus(take, w.i);
      if (!isError(status)) continue;
      // An omitted or teacher-read word was not heard, whatever the engine first guessed.
      const heard = status === 'omitted' || status === 'supplied' ? null : (w.heard ?? null);
      for (const id of classify(w.expected, heard)) {
        const hit = hits.get(id) ?? { id, count: 0, examples: [] };
        hit.count++;
        if (hit.examples.length < MAX_EXAMPLES && !hit.examples.some((e) => e.word === w.expected)) {
          hit.examples.push({ word: w.expected, heard, status, take_id: take.take_id, i: w.i });
        }
        hits.set(id, hit);
      }
    }
  }
  return PATTERN_IDS.filter((id) => hits.has(id)).map((id) => hits.get(id)!);
}

/** Words whose status is settled: everything except the ones still marked uncertain. */
export function confirmedWords(takes: Take[]): number {
  return takes.reduce((n, t) => n + t.words.filter((w) => effectiveStatus(t, w.i) !== 'uncertain').length, 0);
}

/** The take that holds a child's metrics: the latest reading of the card at their level. */
export function levelTake(takes: Take[], level: ChildLevel): Take | null {
  const card = LEVEL_CARD[level];
  return [...takes].filter((t) => t.card.level === card).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

/**
 * The cards a child's error patterns come from: the card at their level once there is one. A child
 * placed at huruf also tried the paragraf card on the way down; the words they could not yet read
 * there say nothing about what to practise next. With no level yet, every card read counts.
 */
export function patternTakes(takes: Take[], level: ChildLevel | null): Take[] {
  const take = level ? levelTake(takes, level) : null;
  return take ? [take] : takes;
}

/** The latest paragraf reading in the session that has at least one tapped answer. */
export function comprehensionTake(takes: Take[]): Take | null {
  return [...takes].filter((t) => comprehension(t)).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

export interface EarlierResult {
  session_id: string;
  at: number;
  level: ChildLevel;
  unit: Unit;
  correctUnitsPerMinute: number | null;
}

/** This child's own confirmed results before `before`, oldest first. Only this child; nobody else appears. */
export function earlierResults(student_ref: string, sessions: Session[], takes: Record<string, Take>, before: number, except?: string): EarlierResult[] {
  return sessions
    .filter(
      (s) =>
        s.student_ref === student_ref &&
        s.session_id !== except &&
        !s.simulated &&
        s.suggestion?.status === 'confirmed' &&
        s.suggestion.confirmed?.level &&
        s.suggestion.confirmed.at < before,
    )
    .sort((a, b) => a.suggestion!.confirmed!.at - b.suggestion!.confirmed!.at)
    .map((s) => {
      const level = s.suggestion!.confirmed!.level!;
      const own = s.take_ids.map((id) => takes[id]).filter((t): t is Take => Boolean(t));
      const take = levelTake(own, level);
      return {
        session_id: s.session_id,
        at: s.suggestion!.confirmed!.at,
        level,
        unit: LEVEL_UNIT(level),
        correctUnitsPerMinute: take ? cardMetrics(take).correctUnitsPerMinute : null,
      };
    });
}

/** How many children in a group hit each pattern. Counts only; children are never listed in any order of a number. */
export function groupPatternCounts(sessionsTakes: Take[][]): { id: PatternId; children: number }[] {
  const counts = new Map<PatternId, number>();
  for (const takes of sessionsTakes) for (const hit of patternHits(takes)) counts.set(hit.id, (counts.get(hit.id) ?? 0) + 1);
  return PATTERN_IDS.filter((id) => counts.has(id))
    .map((id) => ({ id, children: counts.get(id)! }))
    .sort((a, b) => b.children - a.children || PATTERN_IDS.indexOf(a.id) - PATTERN_IDS.indexOf(b.id));
}
