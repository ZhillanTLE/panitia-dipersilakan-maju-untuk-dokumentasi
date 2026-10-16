import { useSyncExternalStore } from 'react';
import { getApp } from './store';
import type { ChildLevel } from '../types';

// Client of the Flask planner API. No planning logic here: the server groups, plans, checks and
// schedules. This file builds the sync payload from confirmed levels, holds the screen state and
// does the small amount of timetable arithmetic needed to move a session between slots.

export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export const DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_LABEL: Record<Day, string> = { Mon: 'Sen', Tue: 'Sel', Wed: 'Rab', Thu: 'Kam', Fri: 'Jum', Sat: 'Sab', Sun: 'Min' };

export interface Slot {
  day: Day;
  start: string;
  end: string;
}

export interface Settings {
  teacherCode: string;
  startDate: string;
  cycleWeeks: number;
  phones: number;
  holidays: string[];
  timetable: Slot[];
}

export interface PlanSession {
  id: string;
  week: number;
  kind: 'practice' | 'replacement';
  activityId: string | null;
  passageIds: string[];
  minutes: number;
  focus: string;
  students?: string[];
}

export interface PlanGroup {
  level: ChildLevel;
  name: string;
  size: number;
  students: string[];
  evidence: string[];
  sessions: PlanSession[];
}

export interface Plan {
  id: string;
  classCode: string;
  startDate: string;
  cycleWeeks: number;
  weeksPlanned: number[];
  groups: PlanGroup[];
  phones: number;
  timetable: Slot[];
  holidays: string[];
}

export interface CalEvent {
  id: string;
  planSessionId: string;
  groupLevel: ChildLevel;
  kind: 'practice' | 'replacement';
  week: number;
  date: string;
  day: Day;
  start: string;
  end: string;
  minutes: number;
  lane: number;
  activityId: string | null;
  passageIds: string[];
  focus: string;
  students: string[];
}

export interface Unscheduled {
  planSessionId: string;
  groupLevel: ChildLevel;
  kind: 'practice' | 'replacement';
  week: number;
  minutes: number;
  activityId: string | null;
  passageIds: string[];
  focus: string;
  students: string[];
  reason: string;
}

export interface TraceEntry {
  stage: 'intake' | 'evidence' | 'planner' | 'checker' | 'scheduler';
  status: 'running' | 'done' | 'failed' | 'fallback' | 'reused';
  startedAt: string;
  ms?: number;
  summary?: string;
  lines?: Record<string, string[]>;
  discarded?: unknown[];
  writtenBy?: string;
  plannedBy?: string;
  attempts?: number;
  failures?: { group: string; rule: string; detail: string }[];
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  unscheduled?: Unscheduled[];
}

export interface RunResult {
  mode: { inference: 'mock' | 'live' | 'replay'; data: string; capturedWith?: string };
  trace: TraceEntry[];
  plan: Plan;
  calendar: { events: CalEvent[]; unscheduled: Unscheduled[] };
}

export interface Approved {
  plan: Plan;
  calendar: { events: CalEvent[]; unscheduled: Unscheduled[] };
  approvedAt: string;
  queuedForPhone: boolean;
  syncedToPhoneAt: string | null;
}

export interface ReportChild {
  code: string;
  before: ChildLevel;
  after: ChildLevel | null;
  move: 'naik' | 'tetap' | 'turun' | 'belum';
  wcpmBefore: number | null;
  wcpmAfter: number | null;
}

export interface Report {
  planId: string;
  groups: {
    level: ChildLevel;
    name: string;
    size: number;
    moved: { up: number; stayed: number; down: number; notYet: number };
    sessions: { planned: number; done: number };
    children: ReportChild[];
  }[];
}

export interface Done {
  planSessionId: string;
  date: string;
  done: boolean;
}

// ───────────── settings, kept on this device ─────────────

const KEY = 'dengarbaca.planner.v1';

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return iso(d);
}

export function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DEFAULTS: Settings = {
  teacherCode: 'G-01',
  startDate: nextMonday(),
  cycleWeeks: 2,
  phones: 1,
  holidays: [],
  timetable: [
    { day: 'Mon', start: '08:00', end: '08:35' },
    { day: 'Wed', start: '08:00', end: '08:35' },
    { day: 'Fri', start: '10:00', end: '10:35' },
  ],
};

interface Saved {
  settings: Settings;
  done: Done[];
  preparedAt: number | null;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { settings: DEFAULTS, done: [], preparedAt: null, ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    // Storage blocked: settings last until the page closes.
  }
  return { settings: DEFAULTS, done: [], preparedAt: null };
}

interface PlannerState extends Saved {
  health: { mode: RunResult['mode']; inferenceConfigured: boolean } | 'offline' | null;
  running: boolean;
  error: { message: string; problems?: string[]; refused?: boolean } | null;
  result: RunResult | null;
  events: CalEvent[];
  unscheduled: Unscheduled[];
  approved: Approved | null;
  report: Report | null;
}

let state: PlannerState = {
  ...load(),
  health: null,
  running: false,
  error: null,
  result: null,
  events: [],
  unscheduled: [],
  approved: null,
  report: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<PlannerState>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ settings: state.settings, done: state.done, preparedAt: state.preparedAt }));
  } catch {
    // See load().
  }
  listeners.forEach((l) => l());
}

export function usePlanner(): PlannerState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function updateSettings(patch: Partial<Settings>): void {
  set({ settings: { ...state.settings, ...patch } });
}

// ───────────── payload from confirmed levels ─────────────

export interface SyncSummary {
  classCode: string;
  included: number;
  excluded: number;
  demo: boolean;
  byLevel: Map<ChildLevel, number>;
}

export function buildPayload(): { payload: Record<string, unknown>; summary: SyncSummary } {
  const app = getApp();
  const s = state.settings;
  const classCode = app.students[0]?.student_ref.split('-')[0] ?? 'K1';
  const placed = app.students.filter((st) => st.level);
  const byLevel = new Map<ChildLevel, number>();
  const students = placed.map((st) => {
    const level = st.level!;
    byLevel.set(level.value, (byLevel.get(level.value) ?? 0) + 1);
    const takes = Object.values(app.takes).filter((t) => t.session_id === level.session_id && t.fluency.wcpm !== null);
    const wcpm = takes.length ? Math.round(takes[takes.length - 1].fluency.wcpm ?? 0) : undefined;
    return {
      code: st.student_ref,
      confirmedLevel: level.value,
      confirmedAt: iso(new Date(level.confirmed_at)),
      ...(wcpm ? { wcpmUnseen: wcpm } : {}),
    };
  });
  return {
    payload: {
      schemaVersion: '1.0',
      class: { code: classCode, teacherCode: s.teacherCode, phones: s.phones, cycleWeeks: s.cycleWeeks, startDate: s.startDate, holidays: s.holidays },
      timetable: s.timetable.map((t) => ({ ...t, kind: 'literacy' })),
      students,
      sessionsDone: state.done,
    },
    summary: { classCode, included: placed.length, excluded: app.students.length - placed.length, demo: placed.some((st) => st.level?.demo), byLevel },
  };
}

// ───────────── API ─────────────

class ApiError extends Error {
  constructor(
    message: string,
    readonly problems?: string[],
    readonly refused = false,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/planner/${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('offline');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[]; reason?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Server menjawab ${res.status}`, data.problems, data.reason === 'live_inference_unconfigured');
  return data as T;
}

function failure(e: unknown): PlannerState['error'] {
  if (e instanceof ApiError) return e.message === 'offline' ? { message: 'offline' } : { message: e.message, problems: e.problems, refused: e.refused };
  return { message: String(e) };
}

export async function checkHealth(): Promise<void> {
  try {
    set({ health: await call('health') });
  } catch {
    set({ health: 'offline' });
  }
}

/** Restores the draft and the approved plan the server holds for this class. */
export async function restore(): Promise<void> {
  const { summary } = buildPayload();
  try {
    const data = await call<{ draft: RunResult | null; approved: Approved | null }>(`plan/${summary.classCode}`);
    const patch: Partial<PlannerState> = { approved: data.approved };
    const source = data.approved ?? data.draft;
    if (source && !state.result) {
      patch.events = source.calendar.events;
      patch.unscheduled = source.calendar.unscheduled;
      patch.result = { mode: state.health && state.health !== 'offline' ? state.health.mode : { inference: 'mock', data: 'synced' }, trace: [], plan: source.plan, calendar: source.calendar };
    }
    set(patch);
  } catch {
    // Nothing stored, or the server is down; checkHealth reports the second case.
  }
}

export async function runPlan(overrides?: Partial<Settings>): Promise<boolean> {
  if (overrides) updateSettings(overrides);
  const { payload } = buildPayload();
  set({ running: true, error: null, result: null, report: null });
  try {
    const result = await call<RunResult>('run', payload);
    set({ running: false, result, events: result.calendar.events, unscheduled: result.calendar.unscheduled, approved: null, preparedAt: Date.now() });
    return true;
  } catch (e) {
    set({ running: false, error: failure(e) });
    return false;
  }
}

export async function approvePlan(): Promise<boolean> {
  const r = state.result;
  if (!r) return false;
  set({ running: true, error: null });
  try {
    await call('approve', { classCode: r.plan.classCode, planId: r.plan.id, events: state.events });
    await restoreApproved(r.plan.classCode);
    set({ running: false });
    return true;
  } catch (e) {
    set({ running: false, error: failure(e) });
    return false;
  }
}

async function restoreApproved(classCode: string): Promise<void> {
  const data = await call<{ approved: Approved | null }>(`plan/${classCode}`);
  set({ approved: data.approved });
}

export async function replan(fromDate: string): Promise<boolean> {
  const { payload } = buildPayload();
  set({ running: true, error: null });
  try {
    const result = await call<RunResult>('replan', { payload, fromDate });
    set({ running: false, result, events: result.calendar.events, unscheduled: result.calendar.unscheduled, approved: null });
    return true;
  } catch (e) {
    set({ running: false, error: failure(e) });
    return false;
  }
}

export async function makeReport(): Promise<boolean> {
  const { payload } = buildPayload();
  set({ running: true, error: null });
  try {
    set({ running: false, report: await call<Report>('report', payload) });
    return true;
  } catch (e) {
    set({ running: false, error: failure(e) });
    return false;
  }
}

export function setDone(planSessionId: string, date: string, done: boolean): void {
  set({ done: [...state.done.filter((d) => d.planSessionId !== planSessionId), { planSessionId, date, done }] });
}

export function clearError(): void {
  set({ error: null });
}

// ───────────── timetable arithmetic, for moving a session ─────────────

export const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const toHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export interface DatedSlot {
  key: string;
  week: number;
  date: string;
  day: Day;
  start: number;
  end: number;
}

function parseDate(text: string): Date {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The concrete slots of a plan: timetable x weeks, holidays and days before the start dropped. */
export function slotsOf(plan: Pick<Plan, 'startDate' | 'cycleWeeks' | 'timetable' | 'holidays'>): DatedSlot[] {
  const start = parseDate(plan.startDate);
  const monday = new Date(start);
  monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const out: DatedSlot[] = [];
  for (let week = 1; week <= plan.cycleWeeks; week++) {
    for (let k = 0; k < 7; k++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + 7 * (week - 1) + k);
      const date = iso(d);
      if (d < start || plan.holidays.includes(date)) continue;
      for (const t of plan.timetable) {
        if (t.day === DAYS[k]) out.push({ key: `${date}|${t.start}`, week, date, day: t.day, start: toMin(t.start), end: toMin(t.end) });
      }
    }
  }
  return out;
}

/** Earliest start inside the slot where the session fits: phones respected, a group never overlapping itself. */
export function fitInSlot(events: CalEvent[], slot: DatedSlot, minutes: number, phones: number, level: ChildLevel, ignoreId?: string): number | null {
  const others = events.filter((e) => e.date === slot.date && e.id !== ignoreId);
  for (let a = slot.start; a + minutes <= slot.end; a += 5) {
    const b = a + minutes;
    const hit = others.filter((e) => toMin(e.start) < b && a < toMin(e.end));
    if (hit.some((e) => e.groupLevel === level)) continue;
    const points = [a, ...hit.map((e) => toMin(e.start)).filter((p) => p > a)];
    if (points.every((p) => hit.filter((e) => toMin(e.start) <= p && p < toMin(e.end)).length < phones)) return a;
  }
  return null;
}

export function moveEvent(id: string, slot: DatedSlot): 'ok' | 'nofit' | 'lastweek' {
  const plan = state.result?.plan;
  const e = state.events.find((x) => x.id === id);
  if (!plan || !e) return 'nofit';
  if (e.kind === 'replacement' && slot.week !== plan.cycleWeeks) return 'lastweek';
  const start = fitInSlot(state.events, slot, e.minutes, plan.phones, e.groupLevel, id);
  if (start === null) return 'nofit';
  const moved: CalEvent = { ...e, week: slot.week, date: slot.date, day: slot.day, start: toHHMM(start), end: toHHMM(start + e.minutes) };
  set({ events: state.events.map((x) => (x.id === id ? moved : x)).sort(byTime) });
  return 'ok';
}

export function placeUnscheduled(id: string, slot: DatedSlot): 'ok' | 'nofit' | 'lastweek' {
  const plan = state.result?.plan;
  const u = state.unscheduled.find((x) => x.planSessionId === id);
  if (!plan || !u) return 'nofit';
  if (u.kind === 'replacement' && slot.week !== plan.cycleWeeks) return 'lastweek';
  const start = fitInSlot(state.events, slot, u.minutes, plan.phones, u.groupLevel);
  if (start === null) return 'nofit';
  const placed: CalEvent = {
    id: u.planSessionId,
    planSessionId: u.planSessionId,
    groupLevel: u.groupLevel,
    kind: u.kind,
    week: slot.week,
    date: slot.date,
    day: slot.day,
    start: toHHMM(start),
    end: toHHMM(start + u.minutes),
    minutes: u.minutes,
    lane: 0,
    activityId: u.activityId,
    passageIds: u.passageIds,
    focus: u.focus,
    students: u.students,
  };
  set({ events: [...state.events, placed].sort(byTime), unscheduled: state.unscheduled.filter((x) => x.planSessionId !== id) });
  return 'ok';
}

export function removeEvent(id: string): void {
  set({ events: state.events.filter((e) => e.id !== id) });
}

const byTime = (a: CalEvent, b: CalEvent) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
