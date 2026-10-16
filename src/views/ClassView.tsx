import { useId, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconDownload, IconMic } from '../components/Icons';
import { toast } from '../components/Toast';
import { activitiesFor } from '../lib/activities';
import { formatDate } from '../lib/format';
import { classProgress, nextToRead, stageOf, type Stage } from '../lib/progress';
import { href } from '../lib/route';
import { LEVEL_ORDER } from '../lib/rubric';
import { addStudent, removeStudent, resetAll, setConsent, useApp } from '../lib/store';
import { CONSENT, LEVEL, S } from '../strings';
import type { ChildLevel, Consents, Student } from '../types';
import './ClassView.css';

const CONSENT_KEYS: (keyof Consents)[] = ['assessment', 'audio_research', 'camera_mode_b'];

export function ClassView() {
  const app = useApp();
  const [confirm, setConfirm] = useState<{ message: string; label: string; run: () => void } | null>(null);

  const stages = useMemo(
    () => new Map(app.students.map((s) => [s.student_ref, stageOf(s, app.sessions)])),
    [app.students, app.sessions],
  );
  const progress = classProgress(app.students, app.sessions);
  const upNext = nextToRead(app.students, app.sessions);
  const firstPending = app.students.map((s) => stages.get(s.student_ref)).find((st) => st?.kind === 'pending');

  // Groups by confirmed level only (CLAUDE.md rule 3). Students stay in code order.
  const groups = useMemo(() => {
    const map = new Map<ChildLevel, Student[]>(LEVEL_ORDER.map((l) => [l, []]));
    for (const s of app.students) if (s.level) map.get(s.level.value)?.push(s);
    return [...map].filter(([, list]) => list.length);
  }, [app.students]);
  const confirmedCount = app.students.filter((s) => s.level).length;

  return (
    <section className="kelas" aria-labelledby="kelas-title">
      <header className="kelas__head">
        <div className="kelas__intro">
          <h1 className="kelas__title" id="kelas-title">
            {S.kelas.title}
          </h1>
          <p className="t-b8">{S.kelas.summary(app.students.length, confirmedCount)}</p>
        </div>
        <div className="kelas__next">
          {firstPending?.kind === 'pending' && (
            <a className="btn btn--ghost kelas__btn" href={href('tinjau', firstPending.session_id)}>
              {S.kelas.reviewNext}
            </a>
          )}
          {upNext ? (
            <a className="btn btn--cta" href={href('bacaan', undefined, { student: upNext.student_ref })}>
              <IconMic />
              {S.kelas.readNext(upNext.student_ref)}
            </a>
          ) : (
            app.students.length > 0 && <p className="t-meta">{S.kelas.allPlaced}</p>
          )}
        </div>
      </header>

      {progress.total > 0 && <ProgressBar placed={progress.placed} pending={progress.pending} fresh={progress.fresh} />}

      <section className="kelas__section" aria-labelledby="students-title">
        <div className="head">
          <h2 className="head__title" id="students-title">
            {S.kelas.students}
          </h2>
          <p className="t-meta">{S.kelas.studentsNote}</p>
        </div>
        <div className="sheet">
          <ul className="roster">
            {app.students.map((s) => (
              <StudentRow
                key={s.student_ref}
                student={s}
                stage={stages.get(s.student_ref) ?? { kind: 'new' }}
                onRemove={() =>
                  setConfirm({
                    message: S.kelas.removeConfirm(s.student_ref),
                    label: S.kelas.remove,
                    run: () => {
                      removeStudent(s.student_ref);
                      toast(S.kelas.removed(s.student_ref));
                    },
                  })
                }
              />
            ))}
          </ul>
          <AddStudent existing={app.students} />
        </div>
      </section>

      <section className="kelas__section" aria-labelledby="groups-title">
        <div className="head">
          <h2 className="head__title" id="groups-title">
            {S.kelas.groups}
          </h2>
          <p className="t-meta">{S.kelas.groupsNote}</p>
        </div>
        {groups.length ? (
          <div className="groups">
            {groups.map(([level, students]) => (
              <Group key={level} level={level} students={students} />
            ))}
          </div>
        ) : (
          <div className="groups__empty">
            <ol className="ladder" aria-hidden="true">
              {LEVEL_ORDER.map((l) => (
                <li key={l}>{LEVEL[l]}</li>
              ))}
            </ol>
            <p className="t-b8">{S.kelas.groupsEmpty}</p>
          </div>
        )}
      </section>

      <footer className="kelas__foot">
        <div className="kelas__export">
          <button type="button" className="btn btn--ghost" onClick={() => exportCsv(app.students)} disabled={!confirmedCount}>
            <IconDownload size={14} />
            {S.kelas.export}
          </button>
          <p className="t-meta">{S.kelas.exportNote}</p>
        </div>
        <button
          type="button"
          className="btn btn--text"
          onClick={() =>
            setConfirm({
              message: S.kelas.resetConfirm,
              label: S.kelas.reset,
              run: () => void resetAll().then(() => toast(S.kelas.resetDone)),
            })
          }
        >
          {S.kelas.reset}
        </button>
      </footer>

      <ConfirmDialog
        open={confirm !== null}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.label ?? ''}
        onConfirm={() => confirm?.run()}
        onClose={() => setConfirm(null)}
      />
    </section>
  );
}

/** One bar for the whole class: placed, waiting for review, not read yet. */
function ProgressBar({ placed, pending, fresh }: { placed: number; pending: number; fresh: number }) {
  const total = placed + pending + fresh;
  const parts = [
    { key: 'placed', n: placed, label: S.kelas.progress.placed(placed) },
    { key: 'pending', n: pending, label: S.kelas.progress.pending(pending) },
    { key: 'fresh', n: fresh, label: S.kelas.progress.fresh(fresh) },
  ];
  return (
    <div className="progress" role="group" aria-label={S.kelas.progressLabel}>
      <div className="progress__bar" aria-hidden="true">
        {parts.map(
          (p) =>
            p.n > 0 && <span key={p.key} className={`progress__part progress__part--${p.key}`} style={{ '--w': p.n / total } as CSSProperties} />,
        )}
      </div>
      <ul className="progress__legend">
        {parts.map((p) => (
          <li key={p.key} className={`progress__item progress__item--${p.key}`}>
            {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StudentRow({ student: s, stage, onRemove }: { student: Student; stage: Stage; onRemove: () => void }) {
  return (
    <li className="student">
      <div className="student__who">
        <span className="student__ref">{s.student_ref}</span>
        <span className="student__stage" data-stage={stage.kind}>
          {stage.kind === 'new'
            ? S.ready.stage.new
            : stage.kind === 'pending'
              ? S.ready.stage.pending
              : `${LEVEL[stage.level]}, ${formatDate(s.level?.confirmed_at ?? 0)}`}
        </span>
      </div>
      <div className="student__consents" role="group" aria-label={`${S.kelas.consent} ${s.student_ref}`}>
        {CONSENT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="switch"
            className="switch"
            aria-checked={s.consents[key]}
            disabled={key === 'camera_mode_b'}
            title={key === 'camera_mode_b' ? S.kelas.cameraNote : undefined}
            onClick={() => setConsent(s.student_ref, key, !s.consents[key])}
          >
            <span className="switch__track" aria-hidden="true" />
            {CONSENT[key]}
          </button>
        ))}
      </div>
      <div className="student__actions">
        {stage.kind === 'pending' ? (
          <a className="btn btn--action" href={href('tinjau', stage.session_id)}>
            {S.kelas.review}
          </a>
        ) : (
          <a
            className="btn btn--ghost"
            href={href('bacaan', undefined, { student: s.student_ref })}
          >
            {stage.kind === 'new' ? S.kelas.assess : S.kelas.reread}
          </a>
        )}
        <button type="button" className="btn btn--text" onClick={onRemove}>
          {S.kelas.remove}
        </button>
      </div>
    </li>
  );
}

function Group({ level, students }: { level: ChildLevel; students: Student[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const activities = activitiesFor(level);
  return (
    <article className="group">
      <header className="group__head">
        <h3 className="group__name">{LEVEL[level]}</h3>
        <span className="t-meta">{S.kelas.groupCount(students.length)}</span>
      </header>
      <p className="group__pills">
        {students.map((s) => (
          <span key={s.student_ref} className="chip chip--neutral">
            {s.student_ref}
          </span>
        ))}
      </p>
      <button type="button" className="btn btn--text group__toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        {open ? S.kelas.hideActivities : S.kelas.showActivities}
      </button>
      <ul className="acts-bank" id={panelId} hidden={!open}>
        {activities.map((a) => (
          <li key={a.id} className="acts-bank__item">
            <p className="t-s7">{a.title}</p>
            <p className="t-meta">
              {S.kelas.minutes(a.minutes)}. {S.kelas.materials}: {a.materials}. {S.kelas.activityDraft}.
            </p>
            <ol className="acts-bank__steps">
              {a.steps.map((step, k) => (
                <li key={k}>{step}</li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </article>
  );
}

function nextRef(students: Student[]): string {
  const numbers = students
    .map((s) => /^K2-(\d+)$/.exec(s.student_ref)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `K2-${String(next).padStart(2, '0')}`;
}

function AddStudent({ existing }: { existing: Student[] }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const suggestion = nextRef(existing);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ref = (value || suggestion).trim().toUpperCase();
    if (!addStudent(ref)) {
      setError(S.kelas.duplicate);
      return;
    }
    setValue('');
    setError(null);
    toast(S.kelas.added(ref));
  };

  return (
    <form className="add" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={inputId}>
        {S.kelas.addLabel}
      </label>
      <div className="add__row">
        <input
          id={inputId}
          className="input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder={suggestion}
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          aria-describedby={error ? `${inputId}-error` : undefined}
          aria-invalid={error ? true : undefined}
        />
        <button type="submit" className="btn btn--ghost">
          {S.kelas.add}
        </button>
      </div>
      {error && (
        <p className="add__error" id={`${inputId}-error`}>
          {error}
        </p>
      )}
    </form>
  );
}

/** CSV of confirmed levels only: no scores, in code order (CLAUDE.md rules 3 and 7). */
function exportCsv(students: Student[]): void {
  const rows = [['student_ref', 'level', 'confirmed_at', 'session_id', 'rubric']];
  for (const s of students) {
    if (s.level) rows.push([s.student_ref, s.level.value, new Date(s.level.confirmed_at).toISOString(), s.level.session_id, s.level.rubric]);
  }
  const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `dengarbaca-tingkat-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
