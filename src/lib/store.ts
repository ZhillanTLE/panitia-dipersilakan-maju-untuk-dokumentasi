import { useSyncExternalStore } from 'react';
import type { Consents, Session, Student, Take, WordStatus } from '../types';
import { db } from './db';
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

// Pseudonymous starter roster, so the prototype opens with a class. No results are seeded.
const SEED: [string, boolean, boolean][] = [
  ['K2-01', true, false],
  ['K2-02', true, true],
  ['K2-03', true, false],
  ['K2-04', true, false],
  ['K2-05', true, true],
  ['K2-06', false, false],
  ['K2-07', true, false],
  ['K2-08', true, false],
];

export async function initStore(): Promise<void> {
  try {
    let [students, sessions, takes] = await Promise.all([
      db.all<Student>('students'),
      db.all<Session>('sessions'),
      db.all<Take>('takes'),
    ]);
    if (!students.length && !seeded()) {
      students = SEED.map(([student_ref, assessment, audio_research]) => ({
        student_ref,
        created_at: Date.now(),
        consents: { assessment, audio_research, camera_mode_b: false },
      }));
      await Promise.all(students.map((s) => db.put('students', s)));
      markSeeded();
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

function seeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(SEEDED_KEY, '1');
  } catch {
    // Seeding again next time is harmless.
  }
}

// Students

export function addStudent(student_ref: string): boolean {
  const ref = student_ref.trim().toUpperCase();
  if (!ref || state.students.some((s) => s.student_ref === ref)) return false;
  const student: Student = {
    student_ref: ref,
    created_at: Date.now(),
    consents: { assessment: false, audio_research: false, camera_mode_b: false },
  };
  set({ students: [...state.students, student].sort(byRef) });
  persist(db.put('students', student));
  return true;
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
