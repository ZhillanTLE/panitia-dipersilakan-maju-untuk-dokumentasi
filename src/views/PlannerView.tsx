import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { toast } from '../components/Toast';
import {
  DAYS,
  DAY_LABEL,
  approvePlan,
  buildPayload,
  checkHealth,
  clearError,
  fitInSlot,
  iso,
  makeReport,
  moveEvent,
  placeUnscheduled,
  removeEvent,
  replan,
  restore,
  runPlan,
  setDone,
  slotsOf,
  toMin,
  updateSettings,
  usePlanner,
  type CalEvent,
  type DatedSlot,
  type Day,
  type PlanGroup,
  type TraceEntry,
  type Unscheduled,
} from '../lib/planner';
import { href, navigate } from '../lib/route';
import { LEVEL_ORDER } from '../lib/rubric';
import { useApp } from '../lib/store';
import { P } from '../plannerStrings';
import { LEVEL } from '../strings';
import type { ChildLevel } from '../types';
import './PlannerView.css';

type Step = 'sinkron' | 'pipeline' | 'kalender' | 'laporan';
const STEPS: Step[] = ['sinkron', 'pipeline', 'kalender', 'laporan'];

const t = (hhmm: string) => hhmm.replace(':', '.');
const localDate = (text: string) => {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dayMonth = (text: string) =>
  localDate(text).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
  });
const stamp = (text: string | number) =>
  new Date(text).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const groupStyle = (level: ChildLevel) => ({ '--g': `var(--grp-${level})` }) as CSSProperties;

export function PlannerView({ step }: { step: string | null }) {
  const app = useApp();
  const pl = usePlanner();
  const current: Step = STEPS.includes(step as Step) ? (step as Step) : 'sinkron';

  useEffect(() => {
    void checkHealth().then(() => restore());
  }, [app.students.length]);

  return (
    <section className="rencana" data-wide={current === 'kalender' ? '' : undefined} aria-labelledby="rencana-title">
      <header className="rencana__head">
        <div className="rencana__intro">
          <h1 className="rencana__title" id="rencana-title">
            {P.title}
          </h1>
          <p className="t-b8">{P.intro}</p>
        </div>
        <ModeBadge />
      </header>

      <nav className="steps" aria-label={P.title}>
        <ol className="steps__list">
          {STEPS.map((s, k) => (
            <li key={s}>
              <a className="steps__link" href={href('rencana', undefined, { langkah: s })} aria-current={current === s ? 'step' : undefined}>
                <span className="steps__n" aria-hidden="true">
                  {k + 1}
                </span>
                {P.steps[s]}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {pl.error && !pl.running && <ErrorBox />}
      {current === 'sinkron' && <Sinkron />}
      {current === 'pipeline' && <Pipeline />}
      {current === 'kalender' && <Kalender />}
      {current === 'laporan' && <Laporan />}
    </section>
  );
}

function ModeBadge() {
  const { health } = usePlanner();
  if (!health) return null;
  const offline = health === 'offline';
  const mode = offline ? null : health.mode.inference;
  return (
    <p className="mode" data-mode={offline ? 'offline' : mode} role="status">
      <span className="mode__dot" aria-hidden="true" />
      {P.mode.label}: {offline ? P.mode.offline : P.mode[mode!]}
    </p>
  );
}

function ErrorBox() {
  const { error } = usePlanner();
  if (!error) return null;
  const offline = error.message === 'offline';
  return (
    <div className="notice" role="alert">
      <p className="notice__title">{offline ? P.mode.offline : error.refused ? P.refused : error.message}</p>
      {offline && <p className="t-meta">{P.offlineHelp}</p>}
      {error.refused && <p className="t-meta">{error.message}</p>}
      {error.problems && (
        <ul className="notice__list">
          {error.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn--text" onClick={clearError}>
        Tutup
      </button>
    </div>
  );
}

// ───────────── 1. Sinkron ─────────────

function Sinkron() {
  const app = useApp();
  const pl = usePlanner();
  const s = pl.settings;
  const { summary } = useMemo(() => buildPayload(), [app.students, pl.settings, pl.done]); // eslint-disable-line react-hooks/exhaustive-deps
  const [holiday, setHoliday] = useState('');

  const go = () => {
    navigate('rencana', undefined, { langkah: 'pipeline' });
    void runPlan();
  };
  const canRun = summary.included > 0 && s.timetable.length > 0 && !pl.running;

  return (
    <div className="rencana__body">
      <section className="rpanel" aria-labelledby="sync-title">
        <h2 className="rpanel__title" id="sync-title">
          {P.sync.title}
        </h2>
        <p className="t-meta">{P.sync.note}</p>
        {pl.preparedAt && <p className="t-meta">{P.sync.last(stamp(pl.preparedAt))}</p>}
        <h3 className="rpanel__sub">{P.sync.groups}</h3>
        <ul className="levels">
          {LEVEL_ORDER.map((l) => (
            <li key={l} className="levels__row" style={groupStyle(l)}>
              <span className="levels__swatch" aria-hidden="true" />
              <span>{LEVEL[l]}</span>
              <strong>{summary.byLevel.get(l) ?? 0}</strong>
            </li>
          ))}
        </ul>
        {summary.excluded > 0 && <p className="t-meta">{P.sync.excluded(summary.excluded)}</p>}
        {summary.demo && <p className="t-meta">{P.sync.demo}</p>}
        {summary.included === 0 && <p className="t-meta">{P.sync.nobody}</p>}
      </section>

      <section className="rpanel" aria-labelledby="set-title">
        <h2 className="rpanel__title" id="set-title">
          {P.sync.settings}
        </h2>
        <div className="fields">
          <label className="field">
            <span>{P.sync.start}</span>
            <input className="input" type="date" value={s.startDate} onChange={(e) => e.target.value && updateSettings({ startDate: e.target.value })} />
          </label>
          <label className="field">
            <span>{P.sync.weeks}</span>
            <input
              className="input"
              type="number"
              min={1}
              max={8}
              value={s.cycleWeeks}
              onChange={(e) =>
                updateSettings({
                  cycleWeeks: clamp(Number(e.target.value), 1, 8),
                })
              }
            />
          </label>
          <label className="field">
            <span>{P.sync.phones}</span>
            <input
              className="input"
              type="number"
              min={1}
              max={6}
              value={s.phones}
              onChange={(e) => updateSettings({ phones: clamp(Number(e.target.value), 1, 6) })}
            />
          </label>
        </div>

        <h3 className="rpanel__sub">{P.sync.timetable}</h3>
        <ul className="slots">
          {s.timetable.map((slot, k) => (
            <li key={k} className="slots__row">
              <select
                className="select"
                aria-label={P.sync.day}
                value={slot.day}
                onChange={(e) =>
                  updateSettings({
                    timetable: s.timetable.map((x, i) => (i === k ? { ...x, day: e.target.value as Day } : x)),
                  })
                }
              >
                {DAYS.slice(0, 6).map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABEL[d]}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="time"
                aria-label={P.sync.from}
                value={slot.start}
                onChange={(e) =>
                  updateSettings({
                    timetable: s.timetable.map((x, i) => (i === k ? { ...x, start: e.target.value } : x)),
                  })
                }
              />
              <input
                className="input"
                type="time"
                aria-label={P.sync.to}
                value={slot.end}
                onChange={(e) =>
                  updateSettings({
                    timetable: s.timetable.map((x, i) => (i === k ? { ...x, end: e.target.value } : x)),
                  })
                }
              />
              <button
                type="button"
                className="btn btn--text"
                onClick={() =>
                  updateSettings({
                    timetable: s.timetable.filter((_, i) => i !== k),
                  })
                }
              >
                {P.sync.removeSlot}
              </button>
            </li>
          ))}
        </ul>
        {s.timetable.length === 0 && <p className="t-meta">{P.sync.noSlots}</p>}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() =>
            updateSettings({
              timetable: [...s.timetable, { day: 'Tue', start: '08:00', end: '08:35' }],
            })
          }
        >
          {P.sync.addSlot}
        </button>

        <h3 className="rpanel__sub">{P.sync.holidays}</h3>
        <ul className="chips">
          {s.holidays.map((h) => (
            <li key={h}>
              <button
                type="button"
                className="chip chip--neutral"
                onClick={() =>
                  updateSettings({
                    holidays: s.holidays.filter((x) => x !== h),
                  })
                }
                aria-label={`Hapus libur ${dayMonth(h)}`}
              >
                {dayMonth(h)} ×
              </button>
            </li>
          ))}
        </ul>
        <div className="slots__row">
          <input className="input" type="date" aria-label={P.sync.holidays} value={holiday} onChange={(e) => setHoliday(e.target.value)} />
          <button
            type="button"
            className="btn btn--ghost"
            disabled={!holiday}
            onClick={() => {
              updateSettings({
                holidays: [...new Set([...s.holidays, holiday])].sort(),
              });
              setHoliday('');
            }}
          >
            {P.sync.addHoliday}
          </button>
        </div>
      </section>

      <div className="rencana__go">
        <button type="button" className="btn btn--cta btn--tall" disabled={!canRun} onClick={go}>
          {pl.running ? P.sync.running : P.sync.run}
        </button>
      </div>
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.round(n) : lo));

// ───────────── 2. Pipeline ─────────────

const STAGES: TraceEntry['stage'][] = ['intake', 'evidence', 'planner', 'checker', 'scheduler'];
type Avatar = 'classifier' | 'searcher' | 'notifier';
// Agents get a face; code stages get a dot, so it is clear at a glance which steps a model touched.
const AVATAR: Partial<Record<TraceEntry['stage'], Avatar>> = {
  evidence: 'classifier',
  planner: 'searcher',
};

function statusOf(entry: TraceEntry | undefined, running: boolean, failed: boolean): keyof typeof P.pipeline.status {
  if (running) return 'menunggu';
  if (!entry) return failed ? 'gagal' : 'menunggu';
  if (entry.status === 'fallback') return 'cadangan';
  if (entry.status === 'reused') return 'dipakai';
  if (entry.status === 'failed') return 'gagal';
  return 'selesai';
}

function tagOf(stage: TraceEntry['stage'], entry: TraceEntry | undefined): string {
  if (!AVATAR[stage]) return P.pipeline.tag.code;
  const by = entry?.writtenBy ?? entry?.plannedBy ?? '';
  if (by.startsWith('gemini')) return P.pipeline.tag.gemini;
  if (by.startsWith('rencana dasar')) return P.pipeline.tag.rules;
  if (by.startsWith('rencana sebelumnya')) return P.pipeline.tag.reused;
  if (by.startsWith('replay')) return P.pipeline.tag.replay;
  return P.pipeline.tag.mock;
}

function Pipeline() {
  const pl = usePlanner();
  const trace = pl.result?.trace ?? [];
  const failed = Boolean(pl.error) && !pl.running;

  return (
    <div className="rencana__body">
      <section className="rpanel" aria-labelledby="pipe-title" aria-busy={pl.running}>
        <h2 className="rpanel__title" id="pipe-title">
          {P.pipeline.title}
        </h2>
        {pl.running && <p className="t-meta">{P.pipeline.waiting}</p>}
        <ol className="tl">
          {STAGES.map((stage, k) => {
            const entry = trace.find((x) => x.stage === stage);
            const status = statusOf(entry, pl.running, failed && stage === 'intake');
            const avatar = AVATAR[stage];
            const face = status === 'menunggu' || status === 'gagal' ? 'sleep' : 'finished';
            return (
              <li
                key={stage}
                className="tl__stage"
                data-status={status}
                data-last={k === STAGES.length - 1 ? '' : undefined}
                aria-label={`${P.pipeline.agentName[stage]}: ${P.pipeline.status[status]}`}
              >
                {avatar ? (
                  <span className="tl__avatar" aria-hidden="true">
                    {(['sleep', 'awake', 'finished'] as const).map((s) => (
                      <span
                        key={s}
                        className="tl__face"
                        style={{
                          backgroundImage: `url(./agents/${avatar}-${s}.svg)`,
                          opacity: s === face ? 1 : 0,
                        }}
                      />
                    ))}
                  </span>
                ) : (
                  <span className="tl__dot" aria-hidden="true" />
                )}
                <div className="tl__head">
                  <span className="tl__name">{P.pipeline.agentName[stage]}</span>
                  <span className="tl__tag">{tagOf(stage, entry)}</span>
                  <span className="tl__status">{P.pipeline.status[status]}</span>
                  <span className="tl__ms">{entry?.ms !== undefined && status !== 'menunggu' ? P.pipeline.secs(entry.ms) : ''}</span>
                </div>
                {entry && status !== 'menunggu' && <StageBody entry={entry} />}
              </li>
            );
          })}
        </ol>
        {pl.result && !pl.running && trace.length > 0 && (
          <div className="rencana__go">
            <a className="btn btn--cta btn--tall" href={href('rencana', undefined, { langkah: 'kalender' })}>
              {P.pipeline.next}
            </a>
          </div>
        )}
      </section>
    </div>
  );
}

function Reasons({ lines }: { lines: string[] }) {
  return (
    <ul className="tl__reasons">
      {lines.filter(Boolean).map((line, k) => (
        <li key={k}>
          <span aria-hidden="true">→</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

const RULES: { label: string; keys: string[] }[] = [
  {
    label: P.pipeline.rules.library,
    keys: ['activity_id', 'activity_level', 'kind', 'empty'],
  },
  { label: P.pipeline.rules.passages, keys: ['passage_id'] },
  { label: P.pipeline.rules.budget, keys: ['budget', 'minutes', 'week'] },
  { label: P.pipeline.rules.words, keys: ['banned_word'] },
  {
    label: P.pipeline.rules.replacement,
    keys: ['replacement', 'replacement_week'],
  },
];

function StageBody({ entry }: { entry: TraceEntry }) {
  const pl = usePlanner();
  const plan = pl.result?.plan;
  const C = P.pipeline.col;

  if (entry.stage === 'intake') {
    const groups = (entry as TraceEntry & { groups?: { level: ChildLevel; size: number }[] }).groups ?? [];
    return <Reasons lines={[entry.summary ?? '', groups.map((g) => `${LEVEL[g.level]} ${g.size}`).join(' · '), P.pipeline.levelsOnly]} />;
  }

  if (entry.stage === 'evidence') {
    const discarded = (entry.discarded ?? []) as {
      level?: string;
      line?: string;
      field?: string;
      reason: string;
    }[];
    return (
      <>
        <Reasons lines={Object.values(entry.lines ?? {}).flat()} />
        {discarded.length > 0 && (
          <div className="ledger">
            {discarded.map((d, k) => (
              <div key={k} className="ledger__row" data-tone="bad">
                <span className="ledger__n">{String(k + 1).padStart(2, '0')}</span>
                <span className="ledger__main">{d.line ?? d.field ?? d.level}</span>
                <span className="ledger__end">{P.pipeline.discardedRow}</span>
                <span className="ledger__sub">{d.reason}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  if (entry.stage === 'planner' && plan) {
    const last = plan.weeksPlanned[plan.weeksPlanned.length - 1];
    return (
      <div className="ledger">
        <div className="ledger__row ledger__row--head">
          <span className="ledger__n">{C.n}</span>
          <span className="ledger__main">{C.group}</span>
          <span className="ledger__num">{C.sessions}</span>
          <span className="ledger__num">{C.minutes}</span>
          <span className="ledger__end">{C.replacement}</span>
        </div>
        {plan.groups.map((g, k) => {
          const practice = g.sessions.filter((s) => s.kind === 'practice');
          const repl = g.sessions.some((s) => s.kind === 'replacement');
          return (
            <div key={g.level} className="ledger__row" style={groupStyle(g.level)}>
              <span className="ledger__n">{String(k + 1).padStart(2, '0')}</span>
              <span className="ledger__main">
                <span className="levels__swatch" aria-hidden="true" /> {P.cal.group(g.name)} <span className="ledger__dim">· {g.size} anak</span>
              </span>
              <span className="ledger__num">{practice.length}</span>
              <span className="ledger__num">{practice.reduce((n, s) => n + s.minutes, 0)}</span>
              <span className="ledger__end">{repl ? P.cal.week(last) : P.pipeline.noReplacement}</span>
            </div>
          );
        })}
        <div className="ledger__foot">
          <span>{entry.plannedBy && P.pipeline.writtenBy(entry.plannedBy)}</span>
          <span>{entry.attempts && P.pipeline.attempts(entry.attempts)}</span>
        </div>
      </div>
    );
  }

  if (entry.stage === 'checker') {
    const failures = entry.failures ?? [];
    return (
      <div className="ledger">
        <div className="ledger__row ledger__row--head">
          <span className="ledger__n">{C.n}</span>
          <span className="ledger__main">{C.rule}</span>
          <span className="ledger__end">{C.status}</span>
        </div>
        {RULES.map((r, k) => {
          const hits = failures.filter((f) => r.keys.includes(f.rule));
          const word = !hits.length ? P.pipeline.pass : entry.fallbackUsed ? P.pipeline.failedFallback : P.pipeline.repaired;
          return (
            <div key={r.label} className="ledger__row" data-tone={hits.length ? 'bad' : 'good'}>
              <span className="ledger__n">{String(k + 1).padStart(2, '0')}</span>
              <span className="ledger__main">{r.label}</span>
              <span className="ledger__end">{word}</span>
              {hits.length > 0 && <span className="ledger__sub">{hits.map((h) => `${h.group}: ${h.detail}`).join(' · ')}</span>}
            </div>
          );
        })}
        <div className="ledger__foot">
          <span>{entry.fallbackUsed ? `${P.pipeline.fallback}. ${entry.fallbackReason ?? ''}` : P.pipeline.rulesFoot}</span>
          <span>{P.pipeline.attemptsFoot(trace0(pl).find((t) => t.stage === 'planner')?.attempts ?? 1)}</span>
        </div>
      </div>
    );
  }

  if (entry.stage === 'scheduler') {
    const unscheduled = entry.unscheduled ?? [];
    return (
      <>
        <Reasons
          lines={[
            entry.summary ?? '',
            plan ? P.pipeline.phones(plan.phones) : '',
            plan?.holidays.length ? P.pipeline.holidaysSkipped(plan.holidays.map(dayMonth).join(', ')) : '',
            unscheduled.length ? '' : P.pipeline.allFit,
          ]}
        />
        {unscheduled.length > 0 && (
          <div className="ledger">
            {unscheduled.map((u, k) => (
              <div key={u.planSessionId} className="ledger__row" data-tone="bad" style={groupStyle(u.groupLevel)}>
                <span className="ledger__n">{String(k + 1).padStart(2, '0')}</span>
                <span className="ledger__main">
                  {P.cal.group(LEVEL[u.groupLevel])} <span className="ledger__dim">· {P.cal.week(u.week)}</span>
                </span>
                <span className="ledger__end">{P.cal.unscheduled}</span>
                <span className="ledger__sub">{u.reason}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
  return entry.summary ? <Reasons lines={[entry.summary]} /> : null;
}

const trace0 = (pl: ReturnType<typeof usePlanner>) => pl.result?.trace ?? [];

// ───────────── 3. Kalender ─────────────

const DAY_FULL: Record<Day, string> = {
  Mon: 'Senin',
  Tue: 'Selasa',
  Wed: 'Rabu',
  Thu: 'Kamis',
  Fri: 'Jumat',
  Sat: 'Sabtu',
  Sun: 'Minggu',
};
const PXM = 7; // pixels per minute
const GAP = 34; // the folded stretch between two literacy periods

interface Axis {
  segs: { from: number; to: number; y: number }[];
  height: number;
}

/** A time axis that keeps only the literacy periods and folds the hours between them. */
function axisOf(slots: DatedSlot[]): Axis {
  const iv = slots.map((s) => [s.start, s.end] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const segs: Axis['segs'] = [];
  let y = 0;
  merged.forEach(([from, to], k) => {
    if (k) y += GAP;
    segs.push({ from, to, y });
    y += (to - from) * PXM;
  });
  return { segs, height: y };
}

const yAt = (axis: Axis, m: number): number | null => {
  const s = axis.segs.find((x) => m >= x.from && m <= x.to);
  return s ? s.y + (m - s.from) * PXM : null;
};

const minuteAt = (axis: Axis, y: number): number | null => {
  const s = axis.segs.find((x) => y >= x.y && y <= x.y + (x.to - x.from) * PXM);
  return s ? s.from + Math.floor((y - s.y) / PXM) : null;
};

function ticksOf(axis: Axis): number[] {
  const out: number[] = [];
  for (const s of axis.segs) {
    out.push(s.from);
    for (let m = Math.ceil((s.from + 1) / 30) * 30; m < s.to; m += 30) out.push(m);
  }
  return out;
}

const initials = (code: string) => code.split('-').pop() ?? code;

function Kalender() {
  const pl = usePlanner();
  const result = pl.result;
  const [week, setWeek] = useState(1);
  const [dragging, setDragging] = useState<string | null>(null);
  const [only, setOnly] = useState<ChildLevel | null>(null);
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const slots = useMemo(() => (result ? slotsOf(result.plan) : []), [result]);
  if (!result) {
    return (
      <div className="rencana__body">
        <section className="rpanel">
          <p className="t-b8">Belum ada rencana.</p>
          <a className="btn btn--cta" href={href('rencana', undefined, { langkah: 'sinkron' })}>
            {P.steps.sinkron}
          </a>
        </section>
      </div>
    );
  }

  const plan = result.plan;
  const approved = pl.approved;
  const groups = new Map(plan.groups.map((g) => [g.level, g]));
  const weekEvents = pl.events.filter((e) => e.week === week);
  const weekSlots = slots.filter((s) => s.week === week);
  const axis = axisOf(weekSlots.length ? weekSlots : slots);
  const columns = DAYS.filter((d) => plan.timetable.some((x) => x.day === d));
  const today = iso(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const label = (e: CalEvent | Unscheduled) => describe(e, groups.get(e.groupLevel));
  const outcome = (r: 'ok' | 'nofit' | 'lastweek') => {
    if (r === 'nofit') toast(P.cal.noFit);
    if (r === 'lastweek') toast(P.cal.notLastWeek);
  };
  const doneOf = (id: string) => pl.done.find((d) => d.planSessionId === id)?.done ?? false;
  const planned = pl.events.filter((e) => e.kind === 'practice');
  const weekPractice = weekEvents.filter((e) => e.kind === 'practice');
  const S2 = P.cal.stats;
  const first = weekSlots[0]?.date;
  const lastDay = weekSlots[weekSlots.length - 1]?.date;

  const stats = [
    {
      icon: <IconSessions />,
      label: S2.week,
      value: S2.sessions(weekEvents.length),
      chip: P.cal.week(week),
      tone: 'neutral',
    },
    {
      icon: <IconCheck />,
      label: S2.done,
      value: S2.of(planned.filter((e) => doneOf(e.id)).length, planned.length),
      chip: approved ? (approved.queuedForPhone ? 'menunggu sinkron' : 'di ponsel') : S2.draft,
      tone: approved ? 'good' : 'caution',
    },
    // Shown only when something did not fit; nothing to say when everything did.
    ...(pl.unscheduled.length
      ? [{ icon: <IconAlert />, label: S2.unscheduled, value: S2.sessions(pl.unscheduled.length), chip: S2.needsPlace, tone: 'bad' }]
      : []),
    {
      icon: <IconPhone />,
      label: S2.slots,
      value: S2.slotCount(weekSlots.length),
      chip: S2.phones(plan.phones),
      tone: 'neutral',
    },
  ];

  return (
    <div className="rencana__body rencana__body--wide">
      <div className="calbar">
        <div role="tablist" aria-label={P.cal.title} className="weeks">
          {plan.weeksPlanned.map((w) => (
            <button key={w} type="button" role="tab" className="weeks__tab" aria-selected={week === w} onClick={() => setWeek(w)}>
              {P.cal.week(w)}
            </button>
          ))}
        </div>
        {first && (
          <p className="calbar__range">
            {dayMonth(first)} – {dayMonth(lastDay ?? first)}
          </p>
        )}
        <p className="calbar__status t-meta">
          {approved
            ? approved.queuedForPhone
              ? P.cal.approved(stamp(approved.approvedAt))
              : P.cal.delivered(stamp(approved.syncedToPhoneAt ?? approved.approvedAt))
            : P.cal.draft}
        </p>
        {!approved && (
          <button
            type="button"
            className="btn btn--cta"
            disabled={pl.running}
            onClick={() => void approvePlan().then((ok) => ok && toast('Rencana disetujui'))}
          >
            {pl.running ? P.cal.approving : P.cal.approve}
          </button>
        )}
      </div>

      <div className="filters" role="group" aria-label={P.sync.groups}>
        <button type="button" className="filters__chip" aria-pressed={only === null} onClick={() => setOnly(null)}>
          {P.cal.all} <span className="filters__n">{weekEvents.length}</span>
        </button>
        {plan.groups.map((g) => (
          <button
            key={g.level}
            type="button"
            className="filters__chip"
            style={groupStyle(g.level)}
            aria-pressed={only === g.level}
            onClick={() => setOnly((cur) => (cur === g.level ? null : g.level))}
          >
            <span className="levels__swatch" aria-hidden="true" />
            {g.name} <span className="filters__n">{weekEvents.filter((e) => e.groupLevel === g.level).length}</span>
          </button>
        ))}
      </div>

      <div className="board">
        <div className="wk" style={{ '--cols': columns.length } as CSSProperties}>
          <div className="wk__corner">
            <span>M</span>
            <strong>{week}</strong>
          </div>
          {columns.map((day) => {
            const date = columnDate(plan.startDate, week, day);
            return (
              <div
                key={day}
                className="wk__dayhead"
                aria-current={date === today ? 'date' : undefined}
                data-off={plan.holidays.includes(date) ? '' : undefined}
              >
                <span className="wk__dayname">{DAY_FULL[day]}</span>
                <span className="wk__date">
                  {localDate(date).toLocaleDateString('id-ID', {
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </span>
              </div>
            );
          })}

          <div className="wk__gutter" style={{ height: axis.height }}>
            {ticksOf(axis).map((m) => (
              <span key={m} className="wk__tick" style={{ top: yAt(axis, m) ?? 0 }}>
                {t(toHHMMLocal(m))}
              </span>
            ))}
            {axis.segs.slice(1).map((s) => (
              <span key={s.y} className="wk__fold" style={{ top: s.y - GAP, height: GAP }}>
                {P.cal.gap}
              </span>
            ))}
          </div>

          {columns.map((day) => {
            const date = columnDate(plan.startDate, week, day);
            const holiday = plan.holidays.includes(date);
            const daySlots = weekSlots.filter((s) => s.date === date);
            const dayEvents = weekEvents.filter((e) => e.date === date);
            const nowY = date === today ? yAt(axis, nowMin) : null;
            return (
              <div
                key={day}
                className="wk__col"
                style={{ height: axis.height }}
                data-off={holiday ? '' : undefined}
                data-drop={dragging && !holiday ? '' : undefined}
                onDragOver={(e) => dragging && !holiday && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain') || dragging;
                  setDragging(null);
                  const m = minuteAt(axis, e.clientY - e.currentTarget.getBoundingClientRect().top);
                  const slot = m === null ? undefined : daySlots.find((s) => m >= s.start && m <= s.end);
                  if (id && slot) outcome(moveEvent(id, slot));
                  else if (id) toast(P.cal.noFit);
                }}
              >
                {ticksOf(axis).map((m) => (
                  <span key={m} className="wk__line" style={{ top: yAt(axis, m) ?? 0 }} />
                ))}
                {axis.segs.slice(1).map((s) => (
                  <span key={s.y} className="wk__foldband" style={{ top: s.y - GAP, height: GAP }} />
                ))}
                {holiday && <span className="wk__holiday">{P.cal.holiday}</span>}
                {daySlots.map((s) => (
                  <span
                    key={s.key}
                    className="wk__slot"
                    style={{
                      top: yAt(axis, s.start) ?? 0,
                      height: (s.end - s.start) * PXM,
                    }}
                  />
                ))}
                {lanes(dayEvents, plan.phones).map(({ e, lane }) => {
                  const h = e.minutes * PXM - 4;
                  const size = h < 56 ? 'xs' : h < 84 ? 's' : h < 120 ? 'm' : 'l';
                  const people = e.kind === 'replacement' ? e.students : (groups.get(e.groupLevel)?.students ?? []);
                  const done = doneOf(e.id);
                  return (
                    <article
                      key={e.id}
                      className="ev"
                      data-size={size}
                      data-kind={e.kind}
                      data-done={done ? '' : undefined}
                      data-dim={only && only !== e.groupLevel ? '' : undefined}
                      style={{
                        ...groupStyle(e.groupLevel),
                        top: (yAt(axis, toMin(e.start)) ?? 0) + 2,
                        height: h,
                        left: `calc(${(lane / plan.phones) * 100}% + 3px)`,
                        width: `calc(${100 / plan.phones}% - 6px)`,
                      }}
                      draggable={!approved}
                      title={label(e)}
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData('text/plain', e.id);
                        setDragging(e.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <div className="ev__top">
                        <span className="ev__icon" aria-hidden="true">
                          {e.kind === 'replacement' ? <IconFlag /> : <IconBook />}
                        </span>
                        <p className="ev__title">{e.kind === 'replacement' ? P.cal.replacement : P.cal.group(LEVEL[e.groupLevel])}</p>
                        {approved && (
                          <button
                            type="button"
                            className="ev__check"
                            aria-pressed={done}
                            aria-label={`${P.cal.markDone}: ${label(e)}`}
                            onClick={() => setDone(e.id, e.date, !done)}
                          >
                            <IconCheck />
                          </button>
                        )}
                      </div>
                      {(size === 'm' || size === 'l') && e.kind === 'practice' && <p className="ev__sub">{e.focus}</p>}
                      {(size === 'm' || size === 'l') && e.kind === 'replacement' && <p className="ev__sub">{P.cal.group(LEVEL[e.groupLevel])}</p>}
                      <p className="ev__time">
                        {t(e.start)} – {t(e.end)}
                      </p>
                      {(size === 'm' || size === 'l') && e.passageIds.length > 0 && <p className="ev__doc">{P.cal.reading(e.passageIds)}</p>}
                      {size === 'l' && (
                        <div className="ev__people">
                          {people.slice(0, 4).map((c) => (
                            <span key={c} className="ev__person" title={c}>
                              {initials(c)}
                            </span>
                          ))}
                          {people.length > 4 && <span className="ev__person ev__person--more">+{people.length - 4}</span>}
                        </div>
                      )}
                    </article>
                  );
                })}
                {nowY !== null && (
                  <span className="wk__now" style={{ top: nowY }}>
                    <span className="wk__nowlabel">{t(toHHMMLocal(nowMin))}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <aside className="side" aria-label="Ringkasan">
          <section className="stats" aria-label={P.cal.title}>
            {stats.map((s) => (
              <div key={s.label} className="stats__item">
                <span className="stats__icon" aria-hidden="true">
                  {s.icon}
                </span>
                <div className="stats__text">
                  <p className="stats__label">{s.label}</p>
                  <p className="stats__value">
                    {s.value}
                    <span className="stats__chip" data-tone={s.tone}>
                      {s.chip}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </section>
          {pl.unscheduled.length > 0 && (
            <section className="lane" aria-labelledby="uns-title">
              <h2 className="lane__head" id="uns-title">
                {P.cal.unscheduled} <span className="filters__n">{pl.unscheduled.length}</span>
              </h2>
              {pl.unscheduled.map((u) => (
                <div key={u.planSessionId} className="lane__card" style={groupStyle(u.groupLevel)}>
                  <p className="ev__title">
                    <span className="levels__swatch" aria-hidden="true" /> {u.kind === 'replacement' ? P.cal.replacement : P.cal.group(LEVEL[u.groupLevel])}
                  </p>
                  <p className="t-meta">
                    {P.cal.week(u.week)} · {u.minutes} menit
                  </p>
                  <p className="lane__reason">{u.reason}</p>
                  {!approved && (
                    <SlotSelect
                      placeholder={P.cal.place}
                      slots={slots.filter((s) => s.week === u.week)}
                      onPick={(slot) => outcome(placeUnscheduled(u.planSessionId, slot))}
                      fits={(slot) => fitInSlot(pl.events, slot, u.minutes, plan.phones, u.groupLevel) !== null}
                    />
                  )}
                </div>
              ))}
            </section>
          )}
          {approved && (
            <section className="side__card" aria-labelledby="progress-title">
              <h2 className="side__title" id="progress-title">
                {P.cal.progress(planned.filter((e) => doneOf(e.id)).length, planned.length)}
              </h2>
              <ul className="progress">
                {plan.groups.map((g) => {
                  const mine = planned.filter((e) => e.groupLevel === g.level);
                  return (
                    <li key={g.level} style={groupStyle(g.level)}>
                      <span className="levels__swatch" aria-hidden="true" />
                      {P.cal.group(g.name)}: {P.cal.progress(mine.filter((e) => doneOf(e.id)).length, mine.length)}
                    </li>
                  );
                })}
              </ul>
              <p className="t-meta">{P.cal.replanNote}</p>
              <div className="slots__row">
                <label className="field">
                  <span>{P.cal.replanFrom}</span>
                  <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={pl.running || !from}
                  onClick={() => void replan(from).then((ok) => ok && navigate('rencana', undefined, { langkah: 'pipeline' }))}
                >
                  {P.cal.replan}
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>

      {!approved && <p className="t-meta">{P.cal.dragHint}</p>}

      <details className="keys">
        <summary>{P.cal.keyboard}</summary>
        <ul className="evlist">
          {weekEvents.map((e) => (
            <li key={e.id} className="evlist__row" style={groupStyle(e.groupLevel)}>
              {approved && (
                <label className="evlist__done">
                  <input
                    type="checkbox"
                    checked={doneOf(e.id)}
                    onChange={(x) => setDone(e.id, e.date, x.target.checked)}
                    aria-label={`${P.cal.done}: ${label(e)}`}
                  />
                </label>
              )}
              <p className="evlist__text">
                <strong>
                  {DAY_LABEL[e.day]} {t(e.start)}–{t(e.end)}
                </strong>{' '}
                · {label(e)}
              </p>
              {!approved && (
                <div className="evlist__actions">
                  <SlotSelect
                    placeholder={P.cal.move}
                    slots={slots}
                    onPick={(slot) => outcome(moveEvent(e.id, slot))}
                    fits={(slot) => fitInSlot(pl.events, slot, e.minutes, plan.phones, e.groupLevel, e.id) !== null}
                  />
                  <button type="button" className="btn btn--text" onClick={() => removeEvent(e.id)}>
                    {P.cal.remove}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </details>

      {weekPractice.length === 0 && weekEvents.length === 0 && <p className="t-meta">{P.cal.noSlot}</p>}
    </div>
  );
}

const svg = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const IconBook = () => (
  <svg {...svg}>
    <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5C4.7 19 4 18.3 4 17.5z" />
    <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5c.8 0 1.5-.7 1.5-1.5z" />
  </svg>
);
const IconFlag = () => (
  <svg {...svg}>
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" />
  </svg>
);
const IconCheck = () => (
  <svg {...svg}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const IconSessions = () => (
  <svg {...svg}>
    <rect x="4" y="5" width="16" height="15" rx="3" />
    <path d="M8 3v4M16 3v4M4 10h16" />
  </svg>
);
const IconAlert = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5M12 16.2v.1" />
  </svg>
);
const IconPhone = () => (
  <svg {...svg}>
    <rect x="7" y="3" width="10" height="18" rx="2.5" />
    <path d="M11 17.5h2" />
  </svg>
);

function SlotSelect({
  placeholder,
  slots,
  onPick,
  fits,
}: {
  placeholder: string;
  slots: DatedSlot[];
  onPick: (s: DatedSlot) => void;
  fits: (s: DatedSlot) => boolean;
}) {
  return (
    <select
      className="select select--small"
      aria-label={placeholder}
      value=""
      onChange={(e) => {
        const slot = slots.find((s) => s.key === e.target.value);
        if (slot) onPick(slot);
      }}
    >
      <option value="">{placeholder}</option>
      {slots.map((s) => (
        <option key={s.key} value={s.key} disabled={!fits(s)}>
          {P.cal.week(s.week)} · {DAY_LABEL[s.day]} {dayMonth(s.date)} · {t(toHHMMLocal(s.start))}–{t(toHHMMLocal(s.end))}
        </option>
      ))}
    </select>
  );
}

const toHHMMLocal = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function columnDate(startDate: string, week: number, day: Day): string {
  const start = localDate(startDate);
  const monday = new Date(start);
  monday.setDate(start.getDate() - ((start.getDay() + 6) % 7) + 7 * (week - 1) + DAYS.indexOf(day));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${monday.getFullYear()}-${p(monday.getMonth() + 1)}-${p(monday.getDate())}`;
}

/** Puts overlapping sessions of one slot side by side, one column per phone. */
function lanes(events: CalEvent[], phones: number): { e: CalEvent; lane: number }[] {
  const out: { e: CalEvent; lane: number }[] = [];
  const free: number[] = Array(phones).fill(0);
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    let lane = free.findIndex((until) => until <= toMin(e.start));
    if (lane < 0) lane = 0;
    free[lane] = toMin(e.end);
    out.push({ e, lane });
  }
  return out;
}

function describe(e: CalEvent | Unscheduled, group: PlanGroup | undefined): string {
  const name = P.cal.group(group?.name ?? LEVEL[e.groupLevel]);
  if (e.kind === 'replacement') return `${P.cal.replacement} · ${name} · ${e.students.join(', ')}`;
  return [name, e.focus && `Kegiatan: ${e.focus}`, P.cal.reading(e.passageIds)].filter(Boolean).join(' · ');
}

// ───────────── 4. Laporan siklus ─────────────

function Laporan() {
  const pl = usePlanner();
  const report = pl.report;
  const num = (n: number | null) => (n === null ? P.report.pending : n.toLocaleString('id-ID'));

  return (
    <div className="rencana__body">
      <section className="rpanel" aria-labelledby="rep-title">
        <h2 className="rpanel__title" id="rep-title">
          {P.report.title}
        </h2>
        <p className="t-meta">{P.report.note}</p>
        <div>
          <button type="button" className="btn btn--cta" disabled={pl.running} onClick={() => void makeReport()}>
            {P.report.run}
          </button>
        </div>
        {!report && !pl.approved && <p className="t-meta">{P.report.none}</p>}
      </section>

      {report &&
        report.groups.map((g) => (
          <section key={g.level} className="rpanel" style={groupStyle(g.level)} aria-label={P.cal.group(g.name)}>
            <h3 className="rpanel__title">
              <span className="levels__swatch" aria-hidden="true" /> {P.cal.group(g.name)} · {g.size} anak
            </h3>
            <ul className="counts">
              <li>
                <strong>{g.moved.up}</strong> {P.report.up}
              </li>
              <li>
                <strong>{g.moved.stayed}</strong> {P.report.stayed}
              </li>
              {g.moved.down > 0 && (
                <li>
                  <strong>{g.moved.down}</strong> {P.report.down}
                </li>
              )}
              <li>
                <strong>{g.moved.notYet}</strong> {P.report.notYet}
              </li>
              <li>
                {P.report.sessions}: <strong>{P.cal.progress(g.sessions.done, g.sessions.planned)}</strong>
              </li>
            </ul>
            <table className="table">
              <caption className="visually-hidden">{P.cal.group(g.name)}</caption>
              <thead>
                <tr>
                  <th scope="col">Kode</th>
                  <th scope="col">Tingkat</th>
                  <th scope="col">{P.report.wcpm}</th>
                </tr>
              </thead>
              <tbody>
                {g.children.map((c) => (
                  <tr key={c.code}>
                    <th scope="row">{c.code}</th>
                    <td>
                      {LEVEL[c.before]} → {c.after ? LEVEL[c.after] : P.report.pending}
                    </td>
                    <td>
                      {num(c.wcpmBefore)} → {num(c.wcpmAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

      {report && (
        <section className="rpanel">
          <p className="t-meta">{P.report.nextNote}</p>
          <div>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                const next = nextCycleStart(pl.settings.startDate, pl.settings.cycleWeeks);
                navigate('rencana', undefined, { langkah: 'pipeline' });
                void runPlan({ startDate: next });
              }}
            >
              {P.report.next}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function nextCycleStart(startDate: string, weeks: number): string {
  const d = localDate(startDate);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * weeks);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
