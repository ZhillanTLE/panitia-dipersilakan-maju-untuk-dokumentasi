import { useSyncExternalStore } from 'react';
import type { Consents, Session, Student, Take, WordStatus } from '../types';
import { db } from './db';
import { DEMO_STUDENTS, LEFT_TO_READ, demoReading } from './demo';
import { suggestLevel } from './rubric';

export interface AppState {
  ready: boolean;
  /** False when IndexedDB is unavailable; data then lasts only until the tab closes. */
  persistent: boolean;
  students: Student[];
  sessions: Session[];
  takes: Record<string, Take>;
}

let state: AppState = { ready: false, persistent: true, students: [], sessions: [], takes: {} };
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useApp(): AppState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function getApp(): AppState {
  return state;
}

function persist(op: Promise<unknown>): void {
  op.catch(() => {
    if (state.persistent) set({ persistent: false });
  });
}

export function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const byRef = (a: Student, b: Student) => a.student_ref.localeCompare(b.student_ref, 'id', { numeric: true });
const SEEDED_KEY = 'dengarbaca.seeded';
const DEMO_KEY = 'dengarbaca.demo.v1';

// Starter roster, so the prototype opens with a class. Sample first names only; no results are seeded.
const SEED: [string, string, boolean, boolean][] = [
  ['K2-01', 'Ani', true, false],
  ['K2-02', 'Bagas', true, true],
  ['K2-03', 'Citra', true, false],
  ['K2-04', 'Dimas', true, false],
  ['K2-05', 'Eka', true, true],
  ['K2-06', 'Fajar', false, false],
  ['K2-07', 'Gita', true, false],
  ['K2-08', 'Hana', true, false],
];
const SEED_NAMES = new Map(SEED.map(([ref, name]) => [ref, name]));

export async function initStore(): Promise<void> {
  try {
    let [students, sessions, takes] = await Promise.all([
      db.all<Student>('students'),
      db.all<Session>('sessions'),
      db.all<Take>('takes'),
    ]);
    if (!students.length && !seeded()) {
      students = SEED.map(([student_ref, name, assessment, audio_research]) => ({
        student_ref,
        name,
        created_at: Date.now(),
        consents: { assessment, audio_research, camera_mode_b: false },
      }));
      await Promise.all(students.map((s) => db.put('students', s)));
      markSeeded();
    }
    // Rosters seeded before names existed get the sample names once.
    const unnamed = students.filter((s) => !s.name && SEED_NAMES.has(s.student_ref));
    if (unnamed.length) {
      students = students.map((s) => (!s.name && SEED_NAMES.has(s.student_ref) ? { ...s, name: SEED_NAMES.get(s.student_ref) } : s));
      await Promise.all(students.filter((s) => unnamed.some((u) => u.student_ref === s.student_ref)).map((s) => db.put('students', s)));
    }
    if (!flag(DEMO_KEY)) {
      ({ students, sessions, takes } = await seedDemo(students, sessions, takes));
      setFlag(DEMO_KEY);
    }
    set({
      ready: true,
      students: students.sort(byRef),
      sessions,
      takes: Object.fromEntries(takes.map((t) => [t.take_id, t])),
    });
  } catch {
    set({ ready: true, persistent: false });
  }
}

/**
 * Example class, added once: six more students for fourteen in all, and confirmed example
 * readings for everyone without a reading of their own, except the last two, who are left
 * for the teacher to read. Real readings already in the browser are never touched.
 */
async function seedDemo(students: Student[], sessions: Session[], takes: Take[]) {
  const added: Student[] = DEMO_STUDENTS.filter(([ref]) => !students.some((s) => s.student_ref === ref)).map(
    ([student_ref, name, assessment, audio_research]) => ({
      student_ref,
      name,
      created_at: Date.now(),
      consents: { assessment, audio_research, camera_mode_b: false },
    }),
  );
  let roster = [...students, ...added].sort(byRef);
  const untouched = roster.filter((s) => !s.level && !sessions.some((x) => x.student_ref === s.student_ref));
  const toSeed = untouched.slice(0, Math.max(0, untouched.length - LEFT_TO_READ));
  const newSessions: Session[] = [];
  const newTakes: Take[] = [];
  roster = roster.map((s) => {
    const k = toSeed.indexOf(s);
    if (k === -1) return s;
    const reading = demoReading(s, 1 + ((k * 3) % 12));
    newSessions.push(reading.session);
    newTakes.push(...reading.takes);
    const confirmed_at = reading.session.suggestion?.confirmed?.at ?? Date.now();
    return { ...s, level: { value: reading.level, confirmed_at, session_id: reading.session.session_id, rubric: reading.rule, demo: true } };
  });
  const changed = roster.filter((s) => added.includes(s) || toSeed.some((t) => t.student_ref === s.student_ref));
  await Promise.all([
    ...changed.map((s) => db.put('students', s)),
    ...newSessions.map((s) => db.put('sessions', s)),
    ...newTakes.map((t) => db.put('takes', t)),
  ]);
  return { students: roster, sessions: [...sessions, ...newSessions], takes: [...takes, ...newTakes] };
}

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Seeding again next time is harmless for the roster; example readings could repeat.
  }
}

const seeded = () => flag(SEEDED_KEY);
const markSeeded = () => setFlag(SEEDED_KEY);

// Students

/** The next free code in the class's pattern, such as K2-09. */
export function nextRef(students: Student[] = state.students): string {
  const numbers = students
    .map((s) => /^K2-(\d+)$/.exec(s.student_ref)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `K2-${String(next).padStart(2, '0')}`;
}

/** Adds a student by first name; the code is assigned. Returns the new code, or null for a repeated name. */
export function addStudent(name: string): string | null {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || state.students.some((s) => s.name?.toLowerCase() === clean.toLowerCase())) return null;
  const ref = nextRef();
  const student: Student = {
    student_ref: ref,
    name: clean,
    created_at: Date.now(),
    consents: { assessment: false, audio_research: false, camera_mode_b: false },
  };
  set({ students: [...state.students, student].sort(byRef) });
  persist(db.put('students', student));
  return ref;
}

export function renameStudent(student_ref: string, name: string): boolean {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || state.students.some((s) => s.student_ref !== student_ref && s.name?.toLowerCase() === clean.toLowerCase())) return false;
  const students = state.students.map((s) => (s.student_ref === student_ref ? { ...s, name: clean } : s));
  set({ students });
  const updated = students.find((s) => s.student_ref === student_ref);
  if (updated) persist(db.put('students', updated));
  return true;
}

/** The name the teacher sees: the first name, or the code when there is none. */
export function nameOf(student_ref: string, students: Student[] = state.students): string {
  return students.find((s) => s.student_ref === student_ref)?.name ?? student_ref;
}

export function setConsent(student_ref: string, key: keyof Consents, value: boolean): void {
  const students = state.students.map((s) =>
    s.student_ref === student_ref ? { ...s, consents: { ...s.consents, [key]: value } } : s,
  );
  set({ students });
  const updated = students.find((s) => s.student_ref === student_ref);
  if (updated) persist(db.put('students', updated));
}

/** Removes the student and every session, take and recording that belongs to them. */
export function removeStudent(student_ref: string): void {
  const sessions = state.sessions.filter((s) => s.student_ref === student_ref);
  const takeIds = sessions.flatMap((s) => s.take_ids);
  const takes = { ...state.takes };
  for (const id of takeIds) delete takes[id];
  set({
    students: state.students.filter((s) => s.student_ref !== student_ref),
    sessions: state.sessions.filter((s) => s.student_ref !== student_ref),
    takes,
  });
  persist(db.delete('students', student_ref));
  for (const s of sessions) persist(db.delete('sessions', s.session_id));
  for (const id of takeIds) {
    persist(db.delete('takes', id));
    persist(db.delete('audio', id));
  }
}

// Sessions and takes

export function addTake(session: Session, take: Take, audio?: Blob): Session {
  const existing = state.sessions.find((s) => s.session_id === session.session_id);
  const next: Session = { ...(existing ?? session), take_ids: [...(existing ?? session).take_ids, take.take_id] };
  set({
    sessions: existing ? state.sessions.map((s) => (s.session_id === next.session_id ? next : s)) : [...state.sessions, next],
    takes: { ...state.takes, [take.take_id]: take },
  });
  persist(db.put('takes', take));
  persist(db.put('sessions', next));
  if (audio) persist(db.put('audio', audio, take.take_id));
  return next;
}

function updateSession(session_id: string, fn: (s: Session) => Session): void {
  const sessions = state.sessions.map((s) => (s.session_id === session_id ? fn(s) : s));
  set({ sessions });
  const updated = sessions.find((s) => s.session_id === session_id);
  if (updated) persist(db.put('sessions', updated));
}

export function takesOf(session: Session, takes = state.takes): Take[] {
  return session.take_ids.map((id) => takes[id]).filter((t): t is Take => Boolean(t));
}

/** Closes the session and stores the engine's suggestion as pending_teacher. */
export function endSession(session_id: string): void {
  updateSession(session_id, (s) => {
    const suggestion = suggestLevel(takesOf(s), false);
    return {
      ...s,
      ended_at: Date.now(),
      suggestion: { level: suggestion.level, rule: suggestion.rule, status: 'pending_teacher' },
    };
  });
}

/** Teacher edit for one word. `null` removes the edit; the engine's status is untouched either way. */
export function setWordEdit(take_id: string, i: number, status: WordStatus | null): void {
  const take = state.takes[take_id];
  if (!take) return;
  const edits = { ...take.teacher.edits };
  if (status === null || status === take.words[i].status) delete edits[i];
  else edits[i] = status;
  const next: Take = { ...take, teacher: { ...take.teacher, edits } };
  set({ takes: { ...state.takes, [take_id]: next } });
  persist(db.put('takes', next));
}

/** The teacher's tap for oral question `k` on a paragraf card: right, wrong, or null for not asked. */
export function setComprehension(take_id: string, k: number, value: boolean | null): void {
  const take = state.takes[take_id];
  if (!take) return;
  const answers = [...(take.teacher.comprehension ?? [])];
  while (answers.length <= k) answers.push(null);
  answers[k] = value;
  const next: Take = { ...take, teacher: { ...take.teacher, comprehension: answers } };
  set({ takes: { ...state.takes, [take_id]: next } });
  persist(db.put('takes', next));
}

export async function getAudio(take_id: string): Promise<Blob | undefined> {
  try {
    return await db.get<Blob>('audio', take_id);
  } catch {
    return undefined;
  }
}

/**
 * The teacher confirms the session. The level is set from the teacher-reviewed words,
 * recordings are deleted unless the research consent is on, and simulated sessions
 * never touch the roster.
 */
export function confirmSession(session_id: string): void {
  const session = state.sessions.find((s) => s.session_id === session_id);
  if (!session) return;
  const now = Date.now();
  const takes = takesOf(session);
  const result = suggestLevel(takes, true);
  const student = state.students.find((s) => s.student_ref === session.student_ref);
  const keepAudio = Boolean(student?.consents.audio_research) && !session.simulated;

  const nextTakes = { ...state.takes };
  for (const take of takes) {
    const audio = take.audio.stored && !keepAudio ? { ...take.audio, stored: false, deleted_at: now } : take.audio;
    nextTakes[take.take_id] = { ...take, audio, teacher: { ...take.teacher, reviewed_at: now } };
    persist(db.put('takes', nextTakes[take.take_id]));
    if (take.audio.stored && !keepAudio) persist(db.delete('audio', take.take_id));
  }

  let students = state.students;
  if (!session.simulated && student && result.level) {
    const level = { value: result.level, confirmed_at: now, session_id, rubric: result.rule };
    students = students.map((s) => (s.student_ref === student.student_ref ? { ...s, level } : s));
    persist(db.put('students', { ...student, level }));
  }

  set({ takes: nextTakes, students });
  updateSession(session_id, (s) => ({
    ...s,
    ended_at: s.ended_at ?? now,
    suggestion: {
      level: s.suggestion?.level ?? null,
      rule: s.suggestion?.rule ?? result.rule,
      status: 'confirmed',
      confirmed: { level: result.level, rule: result.rule, at: now },
    },
  }));
}

export async function resetAll(): Promise<void> {
  try {
    await db.clear();
  } catch {
    // Nothing stored to clear.
  }
  markSeeded();
  set({ students: [], sessions: [], takes: {} });
}
