import type { ChildLevel, Session, Student } from '../types';

// Where each student is in the class's loop: not read yet, read and waiting for the
// teacher's review, or placed at a confirmed level. Simulated sessions never count.

export type Stage =
  | { kind: 'new' }
  | { kind: 'pending'; session_id: string }
  | { kind: 'placed'; level: ChildLevel };

export function stageOf(student: Student, sessions: Session[]): Stage {
  const waiting = sessions
    .filter((s) => !s.simulated && s.student_ref === student.student_ref && s.take_ids.length && s.suggestion?.status !== 'confirmed')
    .sort((a, b) => b.started_at - a.started_at)[0];
  if (waiting) return { kind: 'pending', session_id: waiting.session_id };
  if (student.level) return { kind: 'placed', level: student.level.value };
  return { kind: 'new' };
}

/** The first student in code order who has not been read, skipping `except`. */
export function nextToRead(students: Student[], sessions: Session[], except?: string): Student | null {
  return students.find((s) => s.student_ref !== except && stageOf(s, sessions).kind === 'new') ?? null;
}

export interface ClassProgress {
  total: number;
  fresh: number;
  pending: number;
  placed: number;
}

export function classProgress(students: Student[], sessions: Session[]): ClassProgress {
  const p: ClassProgress = { total: students.length, fresh: 0, pending: 0, placed: 0 };
  for (const s of students) {
    const kind = stageOf(s, sessions).kind;
    if (kind === 'new') p.fresh++;
    else if (kind === 'pending') p.pending++;
    else p.placed++;
  }
  return p;
}
