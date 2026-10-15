import { useId, useMemo, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconMinus, IconPlus } from '../components/Icons';
import { toast } from '../components/Toast';
import { activitiesFor } from '../lib/activities';
import { formatDate } from '../lib/format';
import { href } from '../lib/route';
import { LEVEL_ORDER } from '../lib/rubric';
import { addStudent, removeStudent, resetAll, setConsent, useApp } from '../lib/store';
import { CONSENT, LEVEL, S } from '../strings';
import type { ChildLevel, Consents, Student } from '../types';
import './ClassView.css';

const CONSENT_KEYS: (keyof Consents)[] = ['assessment', 'audio_research', 'camera_mode_b'];

export function ClassView() {
  const app = useApp();
  const [open, setOpen] = useState<ChildLevel | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; label: string; run: () => void } | null>(null);

  // Students with a real, unconfirmed reading waiting in Tinjau.
  const pendingRefs = useMemo(
    () =>
      new Set(
        app.sessions
          .filter((s) => !s.simulated && s.take_ids.length && s.suggestion?.status !== 'confirmed')
          .map((s) => s.student_ref),
      ),
    [app.sessions],
  );

  // Groups by confirmed level only (CLAUDE.md rule 3). Students stay in code order.
  const groups = useMemo(() => {
    const map = new Map<ChildLevel, Student[]>(LEVEL_ORDER.map((l) => [l, []]));
    for (const s of app.students) if (s.level) map.get(s.level.value)?.push(s);
    return map;
  }, [app.students]);
  const unplaced = app.students.filter((s) => !s.level);
  const confirmedCount = app.students.length - unplaced.length;

  return (
    <section className="kelas" aria-labelledby="kelas-title">
      <header className="kelas__head">
        <h1 className="kelas__title" id="kelas-title">
          {S.kelas.title}
        </h1>
        <p className="t-b8">{S.kelas.summary(app.students.length, confirmedCount)}</p>
      </header>

      <section className="kelas__section" aria-labelledby="groups-title">
        <div className="kelas__section-head">
          <h2 className="t-s6" id="groups-title">
            {S.kelas.groups}
          </h2>
          <p className="t-meta">{S.kelas.groupsNote}</p>
        </div>
        <div className="shell">
          {LEVEL_ORDER.map((level) => (
            <GroupRow
              key={level}
              level={level}
              students={groups.get(level) ?? []}
              open={open === level}
              onToggle={() => setOpen((cur) => (cur === level ? null : level))}
            />
          ))}
          <div className="shell__row shell__row--static">
            <div className="shell__head">
              <span className="shell__name">{S.kelas.unplaced}</span>
              <Pills students={unplaced} pending={pendingRefs} />
            </div>
          </div>
        </div>
      </section>

      <section className="kelas__section" aria-labelledby="students-title">
        <div className="kelas__section-head">
          <h2 className="t-s6" id="students-title">
            {S.kelas.students}
          </h2>
          <p className="t-meta">{S.kelas.studentsNote}</p>
        </div>
        <Roster
          students={app.students}
          pending={pendingRefs}
          onRemove={(ref) =>
            setConfirm({
              message: S.kelas.removeConfirm(ref),
              label: S.kelas.remove,
              run: () => {
                removeStudent(ref);
                toast(S.kelas.removed(ref));
              },
            })
          }
        />
        <AddStudent existing={app.students} />
      </section>

      <footer className="kelas__foot">
        <div className="kelas__export">
          <button type="button" className="btn btn--ghost" onClick={() => exportCsv(app.students)} disabled={!confirmedCount}>
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

function Pills({ students, pending }: { students: Student[]; pending?: Set<string> }) {
  if (!students.length) return <span className="shell__empty">{S.kelas.noGroupStudents}</span>;
  return (
    <span className="shell__pills">
      {students.map((s) => (
        <span key={s.student_ref} className={`chip ${pending?.has(s.student_ref) ? 'chip--caution' : 'chip--neutral'}`}>
          {s.student_ref}
        </span>
      ))}
    </span>
  );
}

function GroupRow({
  level,
  students,
  open,
  onToggle,
}: {
  level: ChildLevel;
  students: Student[];
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  const activities = activitiesFor(level);
  return (
    <div className="shell__row">
      <button type="button" className="shell__head" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className="shell__name">{LEVEL[level]}</span>
        <Pills students={students} />
        <span className={`btn btn--round shell__toggle${open ? ' is-on' : ''}`} aria-hidden="true">
          {open ? <IconMinus size={14} /> : <IconPlus size={14} />}
        </span>
      </button>
      <div className="shell__panel" id={panelId} hidden={!open}>
        <ul className="acts-bank">
          {activities.map((a) => (
            <li key={a.id} className="acts-bank__item">
              <div className="acts-bank__head">
                <p className="t-s7">{a.title}</p>
                <span className="chip chip--caution">{S.kelas.activityDraft}</span>
              </div>
              <p className="t-meta">
                {S.kelas.minutes(a.minutes)}. {S.kelas.materials}: {a.materials}.
              </p>
              <ol className="acts-bank__steps">
                {a.steps.map((step, k) => (
                  <li key={k}>{step}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Roster({
  students,
  pending,
  onRemove,
}: {
  students: Student[];
  pending: Set<string>;
  onRemove: (ref: string) => void;
}) {
  return (
    <table className="roster">
      <thead>
        <tr>
          <th scope="col">{S.kelas.addLabel}</th>
          <th scope="col">{S.kelas.consent}</th>
          <th scope="col">{S.kelas.level}</th>
          <th scope="col">
            <span className="visually-hidden">{S.kelas.assess}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {students.map((s) => (
          <tr key={s.student_ref}>
            <th scope="row" className="roster__ref">
              {s.student_ref}
            </th>
            <td>
              <div className="consents">
                {CONSENT_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="consent"
                    aria-pressed={s.consents[key]}
                    disabled={key === 'camera_mode_b'}
                    title={key === 'camera_mode_b' ? S.kelas.cameraNote : undefined}
                    onClick={() => setConsent(s.student_ref, key, !s.consents[key])}
                  >
                    <span className="consent__dot" aria-hidden="true" />
                    {CONSENT[key]}
                  </button>
                ))}
              </div>
            </td>
            <td>
              {s.level ? (
                <span className="roster__level">
                  <span className="chip chip--success">{LEVEL[s.level.value]}</span>
                  <span className="t-meta">{formatDate(s.level.confirmed_at)}</span>
                </span>
              ) : pending.has(s.student_ref) ? (
                <span className="chip chip--caution">{S.kelas.pending}</span>
              ) : (
                <span className="t-meta">{S.kelas.none}</span>
              )}
            </td>
            <td className="roster__actions">
              <a className="btn btn--action" href={href('bacaan', undefined, { student: s.student_ref })}>
                {S.kelas.assess}
              </a>
              <button type="button" className="btn btn--text" onClick={() => onRemove(s.student_ref)}>
                {S.kelas.remove}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
      <label className="add__label" htmlFor={inputId}>
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
        <button type="submit" className="btn btn--action">
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
