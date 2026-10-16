import { cardFor, cardWords } from './cards';
import { CARD_ORDER, RUBRIC_VERSION, nextCard, suggestLevel } from './rubric';
import { ENGINE_VERSION } from './scoring';
import type { CardLevel, ChildLevel, Session, Student, Take, WordResult } from '../types';

// Example class for the prototype: confirmed readings for most of the roster, so Kelas,
// Tinjau and the reading ladder have something to show. Everything made here is marked
// `demo`: the app labels it "contoh", and exports leave it out. It is never a child's result.

export const DEMO_MODEL = 'demo-seed@1';

/** Students added to the starter roster, so the class has fourteen. */
export const DEMO_STUDENTS: [string, string, boolean, boolean][] = [
  ['K2-09', 'Indah', true, false],
  ['K2-10', 'Joko', true, true],
  ['K2-11', 'Kiki', true, false],
  ['K2-12', 'Lina', true, false],
  ['K2-13', 'Maya', true, false],
  ['K2-14', 'Nanda', true, false],
];

/** How many students stay unread, for the teacher to try the reading flow on. */
export const LEFT_TO_READ = 2;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const id = (rand: () => number) => `demo-${Math.floor(rand() * 1e12).toString(36)}-${Math.floor(rand() * 1e12).toString(36)}`;

// Most children land in the middle of the ladder, a few at either end.
const SPREAD: [ChildLevel, number][] = [
  ['pemula', 1],
  ['huruf', 2],
  ['suku_kata', 3],
  ['kata', 3],
  ['kalimat', 2],
  ['paragraf', 1],
];

function pickLevel(rand: () => number): ChildLevel {
  const total = SPREAD.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [level, w] of SPREAD) if ((r -= w) < 0) return level;
  return 'kata';
}

function demoTake(student_ref: string, session_id: string, level: CardLevel, pass: boolean, at: number, rand: () => number): Take {
  const card = cardFor(level);
  const words = cardWords(card);
  const accuracy = pass ? 0.9 + rand() * 0.1 : 0.4 + rand() * 0.35;
  const errors = new Set<number>();
  const wanted = Math.min(words.length, Math.round(words.length * (1 - accuracy)));
  while (errors.size < wanted) errors.add(Math.floor(rand() * words.length));
  const pace = 550 + rand() * 650;
  const results: WordResult[] = words.map((w, k) => {
    const start_ms = Math.round(400 + k * pace + rand() * 120);
    if (!errors.has(k)) return { i: k, expected: w.norm, status: 'correct', heard: w.norm, start_ms, confidence: 'high' };
    const omitted = rand() < 0.3;
    return omitted
      ? { i: k, expected: w.norm, status: 'omitted' }
      : { i: k, expected: w.norm, status: 'substituted', heard: w.norm.slice(0, -1) || `${w.norm}a`, start_ms, confidence: 'medium' };
  });
  const correct = results.filter((r) => r.status === 'correct').length;
  const seconds = Math.round(((words.length * pace) / 1000) * 10) / 10;
  return {
    take_id: id(rand),
    session_id,
    student_ref,
    card: { id: card.id, version: card.version, level },
    source: 'online',
    simulated: false,
    demo: true,
    created_at: at,
    quality: { status: 'not_measured' },
    words: results,
    insertions: [],
    fluency: { reading_time_s: seconds, words_correct: correct, wcpm: Math.round((correct / seconds) * 600) / 10, long_pauses: [] },
    events: [],
    versions: { card: card.version, model: DEMO_MODEL, engine: ENGINE_VERSION, rubric: RUBRIC_VERSION },
    audio: { stored: false },
    teacher: { edits: {}, reviewed_at: at + 60_000, ...(card.questions ? { comprehension: demoAnswers(student_ref, card.questions.length, pass) } : {}) },
  };
}

/** Example taps for the oral questions after a paragraf card. Its own random stream, so the readings stay as they were. */
function demoAnswers(student_ref: string, n: number, pass: boolean): boolean[] {
  const rand = rng(hash(`${student_ref}:pertanyaan`));
  return Array.from({ length: n }, () => rand() < (pass ? 0.85 : 0.45));
}

/** A confirmed example reading for one student, stepping down the cards as a real reading would. */
export function demoReading(student: Student, daysAgo: number): { session: Session; takes: Take[]; level: ChildLevel; rule: string } {
  const rand = rng(hash(student.student_ref));
  const target = pickLevel(rand);
  const started = Date.now() - daysAgo * 86_400_000 - Math.floor(rand() * 6) * 3_600_000;
  const session_id = id(rand);
  const takes: Take[] = [];
  let level: CardLevel | null = CARD_ORDER[0];
  let at = started;
  while (level) {
    const pass = level === target;
    takes.push(demoTake(student.student_ref, session_id, level, pass, at, rand));
    at += 90_000 + Math.floor(rand() * 60_000);
    level = nextCard(level, pass);
  }
  const result = suggestLevel(takes, true);
  const confirmedAt = at + 3_600_000;
  const session: Session = {
    session_id,
    student_ref: student.student_ref,
    started_at: started,
    ended_at: at,
    simulated: false,
    demo: true,
    take_ids: takes.map((t) => t.take_id),
    suggestion: {
      level: result.level,
      rule: result.rule,
      status: 'confirmed',
      confirmed: { level: result.level, rule: result.rule, at: confirmedAt },
    },
  };
  return { session, takes, level: result.level ?? 'pemula', rule: result.rule };
}
