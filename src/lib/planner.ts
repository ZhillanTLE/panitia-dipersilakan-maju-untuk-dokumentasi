import { useSyncExternalStore } from 'react';
import { cardMetrics, comprehensionTake, earlierResults, levelTake, patternHits, patternTakes, type Unit } from './metrics';
import type { PatternId } from './patterns';
import { getApp, takesOf, type AppState } from './store';
import type { ChildLevel, Student } from '../types';

// Client of the Flask planner API. No planning logic here: the server groups, plans, checks and
// schedules. This file builds the sync payload from confirmed levels and reading metrics, holds the screen state and
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
  /** The teacher's switch: run the agents on the Gemini model instead of the rule-built stand-ins. */
  useModel: boolean;
}

export interface PlanSession {
  id: string;
  week: number;
  kind: 'practice' | 'replacement';
  activityId: string | null;
  passageIds: string[];
  minutes: number;
  /** The error pattern the session practises; null for re-placement or a group that showed none. */
  focus: PatternId | null;
  /** The teacher's one-line instruction: the activity, with example words from this group's own readings. */
  tip?: string;
  students?: string[];
}

export interface GroupPattern {
  id: PatternId;
  label: string;
  children: number;
  count: number;
}

export interface PlanGroup {
  level: ChildLevel;
  name: string;
  size: number;
  students: string[];
  unit?: Unit;
  patterns?: GroupPattern[];
  topPatterns?: PatternId[];
  evidence: string[];
  sessions: PlanSession[];
}

/** Stage-0 facts for one group, as the Evidence Summarizer saw them. */
export interface GroupFacts {
  level: ChildLevel;
  name: string;
  size: number;
  unit: Unit;
  unitName: string;
  accuracy: { medianCorrect: number; medianAttempted: number };
  correctUnitsPerMinute: { median: number; children: number } | null;
  practice: { medianSessions: number; medianChange: number | null; children: number };
  comprehension: { medianCorrect: number; medianAsked: number; children: number } | null;
  patterns: (GroupPattern & { examples: string[] })[];
}

export interface Discard {
  level?: string | null;
  line?: string;
  field?: string;
  rule?: string;
  reason: string;
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
  focus: PatternId | null;
  tip?: string;
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
  focus: PatternId | null;
  tip?: string;
  students: string[];
  reason: string;
}

export interface TraceEntry {
  stage: 'intake' | 'evidence' | 'planner' | 'checker' | 'scheduler';
  status: 'running' | 'done' | 'failed' | 'fallback' | 'reused';
  startedAt: string;
  ms?: number;
  summary?: string;
  groups?: { level: ChildLevel; size: number }[];
  facts?: GroupFacts[];
  lines?: Record<string, string[]>;
  discarded?: Discard[];
  writtenBy?: string;
  checked?: number;
  repairs?: number;
  ruleBuilt?: string[];
  evidence?: { checked: number; discarded: number; reused: boolean };
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
  trace?: TraceEntry[];
  mode?: RunResult['mode'];
  syncedToPhoneAt: string | null;
}

export interface ReportChild {
  code: string;
  before: ChildLevel;
  after: ChildLevel | null;
  move: 'naik' | 'tetap' | 'turun' | 'belum';
  unit: Unit | null;
  speedBefore: number | null;
  /** Only in the same unit as before. */
  speedAfter: number | null;
  unitChanged: boolean;
}

export interface Report {
  planId: string;
  groups: {
    level: ChildLevel;
    name: string;
    size: number;
    moved: { up: number; stayed: number; down: number; notYet: number };
    sessions: { planned: number; done: number };
    /** Patterns the plan targeted: how many re-placed children hit each one at the start and now. */
    patterns: { id: PatternId; label: string; children: number; before: number; after: number }[];
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
  useModel: false,
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
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Saved>;
      return { done: [], preparedAt: null, ...saved, settings: { ...DEFAULTS, ...saved.settings } };
    }
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
  /** Confirmed, but the reading behind the level is no longer on this device, so there are no numbers to send. */
  noReading: number;
  demo: boolean;
  byLevel: Map<ChildLevel, number>;
}

/** Above this speed the timing went wrong, so the number is sent as unknown. */
const MAX_SPEED = 400;
const MAX_WORD = 40;

const syncWord = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .slice(0, MAX_WORD);

/**
 * One child's record for the planner: code, confirmed level and the rule-computed metrics of the
 * reading behind it. No name, no audio, no free text. A kept clip goes only as a pointer (take:word)
 * to the recording on this device, and only when the research consent kept it.
 */
function syncStudent(st: Student, app: AppState): Record<string, unknown> | null {
  const level = st.level!;
  const session = app.sessions.find((x) => x.session_id === level.session_id);
  const takes = session ? takesOf(session, app.takes) : [];
  const take = levelTake(takes, level.value);
  if (!session || !take) return null;
  const m = cardMetrics(take);
  // Comprehension counts for children placed at paragraf: the questions are about a passage they can read.
  const comp = level.value === 'paragraf' ? comprehensionTake(takes) : null;
  const answers = comp ? cardMetrics(comp).comprehension : null;
  return {
    code: st.student_ref,
    confirmedLevel: level.value,
    confirmedAt: iso(new Date(level.confirmed_at)),
    levelHistory: earlierResults(st.student_ref, app.sessions, app.takes, level.confirmed_at, session.session_id).map((r) => ({
      level: r.level,
      confirmedAt: iso(new Date(r.at)),
    })),
    metrics: {
      unit: m.unit,
      accuracy: m.accuracy,
      correctUnitsPerMinute: m.correctUnitsPerMinute !== null && m.correctUnitsPerMinute <= MAX_SPEED ? m.correctUnitsPerMinute : null,
      errorCounts: m.errorCounts,
      patterns: patternHits(patternTakes(takes, level.value)).map((h) => ({
        id: h.id,
        count: h.count,
        examples: h.examples
          .filter((e) => syncWord(e.word))
          .map((e) => ({
            word: syncWord(e.word),
            heard: e.heard === null ? null : e.heard.slice(0, MAX_WORD),
            clipId: app.takes[e.take_id]?.audio.stored && !session.simulated ? `${e.take_id}:${e.i}` : null,
          })),
      })),
      longPauses: m.longPauses.count,
      selfCorrections: m.selfCorrections,
      comprehension: answers ? { ...answers, cardUnit: 'paragraf' } : null,
      confidence: {
        uncertainWordShare: m.confidence.uncertainWordShare,
        teacherCorrections: m.confidence.teacherCorrections,
        audioQuality: m.confidence.audioQuality,
      },
    },
    // Practice mode is not built yet, so there are no practice reads to send.
    practice: { sessions: 0, wordsReadBack: [] },
  };
}

export function buildPayload(): { payload: Record<string, unknown>; summary: SyncSummary } {
  const app = getApp();
  const s = state.settings;
  const classCode = app.students[0]?.student_ref.split('-')[0] ?? 'K1';
  const placed = app.students.filter((st) => st.level);
  const byLevel = new Map<ChildLevel, number>();
  const students: Record<string, unknown>[] = [];
  let noReading = 0;
  let demo = false;
  for (const st of placed) {
    const record = syncStudent(st, app);
    if (!record) {
      noReading++;
      continue;
    }
    students.push(record);
    byLevel.set(st.level!.value, (byLevel.get(st.level!.value) ?? 0) + 1);
    if (st.level?.demo) demo = true;
  }
  return {
    payload: {
      schemaVersion: '2.0',
      class: { code: classCode, teacherCode: s.teacherCode, phones: s.phones, cycleWeeks: s.cycleWeeks, startDate: s.startDate, holidays: s.holidays },
      timetable: s.timetable.map((t) => ({ ...t, kind: 'literacy' })),
      students,
      sessionsDone: state.done,
    },
    summary: { classCode, included: students.length, excluded: app.students.length - placed.length, noReading, demo, byLevel },
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
    res = await fetch(
      `/api/planner/${path}`,
      body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
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
    const data = await call<{ draft: (Partial<RunResult> & Pick<RunResult, 'plan' | 'calendar'>) | null; approved: Approved | null }>(
      `plan/${summary.classCode}`,
    );
    // A draft made after the last approval is the plan being worked on; the approved one stays on the phone until it is replaced.
    const draftIsNewer = Boolean(data.draft && data.approved && (data.draft as { savedAt?: string }).savedAt! > data.approved.approvedAt);
    const approved = draftIsNewer ? null : data.approved;
    const patch: Partial<PlannerState> = { approved };
    const source = approved ?? data.draft;
    if (source && !state.result) {
      patch.events = source.calendar.events;
      patch.unscheduled = source.calendar.unscheduled;
      const fallbackMode: RunResult['mode'] = state.health && state.health !== 'offline' ? state.health.mode : { inference: 'mock', data: 'synced' };
      // Older saves have no trace; Proses then says there is nothing to show instead of waiting forever.
      patch.result = { mode: source.mode ?? fallbackMode, trace: source.trace ?? [], plan: source.plan, calendar: source.calendar };
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
    const result = await call<RunResult>(`run?inference=${inferenceChoice()}`, payload);
    const initialUnscheduled: Unscheduled[] = [
      ...result.calendar.events.map((e) => ({
        planSessionId: e.planSessionId,
        groupLevel: e.groupLevel,
        kind: e.kind,
        week: e.week,
        minutes: e.minutes,
        activityId: e.activityId,
        passageIds: e.passageIds,
        focus: e.focus,
        tip: e.tip,
        students: e.students,
        reason: 'Siap dijadwalkan oleh guru',
      })),
      ...result.calendar.unscheduled,
    ];
    set({ running: false, result, events: [], unscheduled: initialUnscheduled, approved: null, preparedAt: Date.now() });
    return true;
  } catch (e) {
    set({ running: false, error: failure(e) });
    return false;
  }
}

function inferenceChoice(): 'live' | 'mock' {
  return state.settings.useModel ? 'live' : 'mock';
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
    const result = await call<RunResult>(`replan?inference=${inferenceChoice()}`, { payload, fromDate });
    const initialUnscheduled: Unscheduled[] = [
      ...result.calendar.events.map((e) => ({
        planSessionId: e.planSessionId,
        groupLevel: e.groupLevel,
        kind: e.kind,
        week: e.week,
        minutes: e.minutes,
        activityId: e.activityId,
        passageIds: e.passageIds,
        focus: e.focus,
        tip: e.tip,
        students: e.students,
        reason: 'Siap dijadwalkan oleh guru',
      })),
      ...result.calendar.unscheduled,
    ];
    set({ running: false, result, events: [], unscheduled: initialUnscheduled, approved: null });
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

/** Whether a session can start at minute `a` on `date`: phones respected, a group never overlapping itself. */
export function fitsAt(events: CalEvent[], date: string, a: number, minutes: number, phones: number, level: ChildLevel, ignoreId?: string): boolean {
  const b = a + minutes;
  const hit = events.filter((e) => e.date === date && e.id !== ignoreId && toMin(e.start) < b && a < toMin(e.end));
  if (hit.some((e) => e.groupLevel === level)) return false;
  const points = [a, ...hit.map((e) => toMin(e.start)).filter((p) => p > a)];
  return points.every((p) => hit.filter((e) => toMin(e.start) <= p && p < toMin(e.end)).length < phones);
}

/** Earliest start inside the slot where the session fits. */
export function fitInSlot(events: CalEvent[], slot: DatedSlot, minutes: number, phones: number, level: ChildLevel, ignoreId?: string): number | null {
  for (let a = slot.start; a + minutes <= slot.end; a += 5) if (fitsAt(events, slot.date, a, minutes, phones, level, ignoreId)) return a;
  return null;
}

// The school day the calendar shows, widened to the timetable. Same rule as school_day() in planner/approval.py.
export const SCHOOL_DAY = { from: 7 * 60, to: 14 * 60 };
export const SCHOOL_DAYS: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function dayBounds(plan: Pick<Plan, 'timetable'>): { from: number; to: number } {
  const starts = plan.timetable.map((t) => toMin(t.start));
  const ends = plan.timetable.map((t) => toMin(t.end));
  const minT = starts.length ? Math.min(...starts) : 7 * 60;
  const maxT = ends.length ? Math.max(...ends) : 12 * 60;
  const from = Math.max(7 * 60, Math.floor(minT / 60) * 60);
  const to = Math.min(15 * 60, Math.max(from + 5 * 60, Math.ceil(maxT / 60) * 60));
  return { from, to };
}

/** Weekdays shown on the calendar: Monday to Friday, plus any other day the timetable uses. */
export function daysOf(plan: Pick<Plan, 'timetable'>): Day[] {
  return DAYS.filter((d) => SCHOOL_DAYS.includes(d) || plan.timetable.some((t) => t.day === d));
}

/** The cycle week a date falls in, or null when it is before the start, after the cycle, a holiday, or not a school day. */
export function weekOfDate(plan: Pick<Plan, 'startDate' | 'cycleWeeks' | 'holidays' | 'timetable'>, date: string): number | null {
  const start = parseDate(plan.startDate);
  const d = parseDate(date);
  const monday = new Date(start);
  monday.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const week = Math.floor(Math.round((d.getTime() - monday.getTime()) / 86_400_000) / 7) + 1;
  const day = DAYS[(d.getDay() + 6) % 7];
  if (d < start || week < 1 || week > plan.cycleWeeks || plan.holidays.includes(date) || !daysOf(plan).includes(day)) return null;
  return week;
}

export type MoveResult = 'ok' | 'nofit' | 'lastweek' | 'closed';

/** Puts a session (on the calendar or still unplaced) at `start` minutes on `date`, if the day and the phones allow it. */
export function moveTo(id: string, date: string, start: number): MoveResult {
  const plan = state.result?.plan;
  const e = state.events.find((x) => x.id === id);
  const u = state.unscheduled.find((x) => x.planSessionId === id);
  const s = e ?? u;
  if (!plan || !s) return 'nofit';
  const week = weekOfDate(plan, date);
  if (week === null) return 'closed';
  if (s.kind === 'replacement' && week !== plan.cycleWeeks) return 'lastweek';
  const { from, to } = dayBounds(plan);
  const target = Math.min(Math.max(from, Math.round(start / 5) * 5), to - s.minutes);
  let bestA: number | null = null;
  const searchOffsets = [0, -5, 5, -10, 10, -15, 15, -20, 20, -25, 25, -30, 30];
  for (const off of searchOffsets) {
    const cand = target + off;
    if (cand >= from && cand + s.minutes <= to && fitsAt(state.events, date, cand, s.minutes, plan.phones, s.groupLevel, e?.id)) {
      bestA = cand;
      break;
    }
  }
  if (bestA === null) return 'nofit';
  const a = bestA;
  const day = DAYS[(parseDate(date).getDay() + 6) % 7];
  const placed: CalEvent = {
    id: s.planSessionId,
    planSessionId: s.planSessionId,
    groupLevel: s.groupLevel,
    kind: s.kind,
    week,
    date,
    day,
    start: toHHMM(a),
    end: toHHMM(a + s.minutes),
    minutes: s.minutes,
    lane: 0,
    activityId: s.activityId,
    passageIds: s.passageIds,
    focus: s.focus,
    tip: s.tip,
    students: s.students,
  };
  set({
    events: [...state.events.filter((x) => x.id !== placed.id), placed].sort(byTime),
    unscheduled: state.unscheduled.filter((x) => x.planSessionId !== id),
  });
  return 'ok';
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
    tip: u.tip,
    students: u.students,
  };
  set({ events: [...state.events, placed].sort(byTime), unscheduled: state.unscheduled.filter((x) => x.planSessionId !== id) });
  return 'ok';
}

export function removeEvent(id: string): void {
  const e = state.events.find((x) => x.id === id);
  if (!e) return;
  const u: Unscheduled = {
    planSessionId: e.planSessionId,
    groupLevel: e.groupLevel,
    kind: e.kind,
    week: e.week,
    minutes: e.minutes,
    activityId: e.activityId,
    passageIds: e.passageIds,
    focus: e.focus,
    tip: e.tip,
    students: e.students,
    reason: 'Ditarik kembali ke antrean',
  };
  set({
    events: state.events.filter((x) => x.id !== id),
    unscheduled: [u, ...state.unscheduled],
  });
}

export function unplaceAll(): void {
  const returned: Unscheduled[] = state.events.map((e) => ({
    planSessionId: e.planSessionId,
    groupLevel: e.groupLevel,
    kind: e.kind,
    week: e.week,
    minutes: e.minutes,
    activityId: e.activityId,
    passageIds: e.passageIds,
    focus: e.focus,
    tip: e.tip,
    students: e.students,
    reason: 'Ditarik kembali ke antrean',
  }));
  set({
    events: [],
    unscheduled: [...returned, ...state.unscheduled],
  });
}

export function autoScheduleAll(): void {
  const plan = state.result?.plan;
  if (!plan) return;
  const slots = slotsOf(plan);
  const remaining = [...state.unscheduled];
  const placedEvents = [...state.events];
  const stillUnscheduled: Unscheduled[] = [];

  for (const u of remaining) {
    let placed = false;
    const weekSlots = slots.filter((s) => s.week === u.week);
    for (const slot of weekSlots) {
      if (u.kind === 'replacement' && slot.week !== plan.cycleWeeks) continue;
      const start = fitInSlot(placedEvents, slot, u.minutes, plan.phones, u.groupLevel);
      if (start !== null) {
        placedEvents.push({
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
          tip: u.tip,
          students: u.students,
        });
        placed = true;
        break;
      }
    }
    if (!placed) {
      stillUnscheduled.push(u);
    }
  }

  set({
    events: placedEvents.sort(byTime),
    unscheduled: stillUnscheduled,
  });
}

const byTime = (a: CalEvent, b: CalEvent) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
