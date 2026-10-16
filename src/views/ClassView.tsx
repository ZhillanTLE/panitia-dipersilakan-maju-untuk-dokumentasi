import { useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconDownload, IconMic } from '../components/Icons';
import { toast } from '../components/Toast';
import { activitiesFor } from '../lib/activities';
import { formatDate } from '../lib/format';
import { nextToRead, stageOf, type Stage } from '../lib/progress';
import { href } from '../lib/route';
import { LEVEL_ORDER } from '../lib/rubric';
import { addStudent, nextRef, removeStudent, renameStudent, resetAll, setConsent, useApp } from '../lib/store';
import { CONSENT, LEVEL, S } from '../strings';
import type { ChildLevel, Consents, Student } from '../types';
import './ClassView.css';

// Camera consent is dropped with the pivot: no camera feature exists. The field stays in stored records.
const CONSENT_KEYS: (keyof Consents)[] = ['assessment', 'audio_research'];

const label = (s: Student) => s.name ?? s.student_ref;

export function ClassView() {
  const app = useApp();
  const [step, setStep] = useState<ChildLevel | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; label: string; run: () => void } | null>(null);

  const stages = useMemo(
    () => new Map(app.students.map((s) => [s.student_ref, stageOf(s, app.sessions)])),
    [app.students, app.sessions],
  );
  const upNext = nextToRead(app.students, app.sessions);
  const firstPending = app.students.map((s) => stages.get(s.student_ref)).find((st) => st?.kind === 'pending');

  // Groups by confirmed level only (CLAUDE.md rule 3). Students stay in code order.
  const groups = useMemo(() => {
    const map = new Map<ChildLevel, Student[]>(LEVEL_ORDER.map((l) => [l, []]));
    for (const s of app.students) if (s.level) map.get(s.level.value)?.push(s);
    return map;
  }, [app.students]);
  const floor = app.students.filter((s) => !s.level);
  const confirmedCount = app.students.length - floor.length;
  const realConfirmed = app.students.filter((s) => s.level && !s.level.demo).length;

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
            <a className="btn btn--ghost btn--tall" href={href('tinjau', firstPending.session_id)}>
              {S.kelas.reviewNext}
            </a>
          )}
          {upNext ? (
            <a className="btn btn--cta" href={href('bacaan', undefined, { student: upNext.student_ref })}>
              <IconMic />
              {S.kelas.readNext(label(upNext))}
            </a>
          ) : (
            app.students.length > 0 && <p className="t-meta">{S.kelas.allPlaced}</p>
          )}
        </div>
      </header>

      <section className="kelas__section" aria-labelledby="ladder-title">
        <div className="head">
          <h2 className="head__title" id="ladder-title">
            {S.kelas.ladder}
          </h2>
          <p className="t-meta">{S.kelas.ladderNote}</p>
        </div>
        <div className="stairs">
          <ol className="stairs__steps">
            {LEVEL_ORDER.map((level, k) => {
              const students = groups.get(level) ?? [];
              return (
                <li key={level} className="stairs__col" style={{ '--k': k } as CSSProperties}>
                  <ul className="stairs__people" aria-label={LEVEL[level]}>
                    {students.map((s) => (
                      <li key={s.student_ref} className="person" data-demo={s.level?.demo ? '' : undefined} title={s.level?.demo ? S.kelas.demoNote : undefined}>
                        {label(s)}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="stairs__step"
                    aria-pressed={step === level}
                    onClick={() => setStep((cur) => (cur === level ? null : level))}
                  >
                    <span className="stairs__name">{LEVEL[level]}</span>
                    <span className="stairs__count">{students.length || S.kelas.stepEmpty}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="stairs__floor">
            <p className="stairs__floor-label">{S.kelas.floor}</p>
            <ul className="stairs__people stairs__people--row">
              {floor.map((s) => (
                <li key={s.student_ref} className="person" data-stage={stages.get(s.student_ref)?.kind}>
                  {label(s)}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {step && <Activities level={step} />}
      </section>

      <section className="kelas__section" aria-labelledby="students-title">
        <div className="head">
          <h2 className="head__title" id="students-title">
            {S.kelas.students}
          </h2>
          <p className="t-meta">{S.kelas.nameNote}</p>
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
                    message: S.kelas.removeConfirm(label(s)),
                    label: S.kelas.remove,
                    run: () => {
                      removeStudent(s.student_ref);
                      toast(S.kelas.removed(label(s)));
                    },
                  })
                }
              />
            ))}
          </ul>
          <AddStudent />
        </div>
      </section>

      <footer className="kelas__foot">
        <div className="kelas__export">
          <button type="button" className="btn btn--ghost" onClick={() => exportCsv(app.students)} disabled={!realConfirmed}>
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

function Activities({ level }: { level: ChildLevel }) {
  return (
    <div className="acts-bank">
      <p className="acts-bank__title">{S.kelas.activitiesFor(LEVEL[level])}</p>
      <ul className="acts-bank__list">
        {activitiesFor(level).map((a) => (
          <li key={a.id} className="acts-bank__item">
            <p className="t-s7">{a.title}</p>
            <p className="t-meta">
              {S.kelas.minutes(a.minutes)}. {S.kelas.materials}: {a.materials}. {S.kelas.activityDraft}.
            </p>
            <ol className="acts-bank__steps">
              {a.steps.map((stepText, k) => (
                <li key={k}>{stepText}</li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StudentRow({ student: s, stage, onRemove }: { student: Student; stage: Stage; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const value = inputRef.current?.value ?? '';
    if (!value.trim() || value.trim() === s.name) {
      setEditing(false);
      return;
    }
    if (renameStudent(s.student_ref, value)) {
      setEditing(false);
      setError(false);
    } else setError(true);
  };

  return (
    <li className="student">
      <div className="student__who">
        {editing ? (
          <input
            ref={inputRef}
            className="input student__input"
            defaultValue={s.name ?? ''}
            aria-label={S.kelas.nameLabel}
            aria-invalid={error || undefined}
            maxLength={24}
            autoFocus
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button type="button" className="student__name" onClick={() => setEditing(true)} aria-label={S.kelas.rename(label(s))}>
            {label(s)}
          </button>
        )}
        <span className="student__meta">
          <span className="student__code">{s.student_ref}</span>
          <span className="student__stage" data-stage={stage.kind}>
            {stage.kind === 'new'
              ? S.ready.stage.new
              : stage.kind === 'pending'
                ? S.ready.stage.pending
                : `${LEVEL[stage.level]}, ${formatDate(s.level?.confirmed_at ?? 0)}`}
          </span>
          {stage.kind === 'placed' && s.level?.demo && (
            <span className="student__demo" title={S.kelas.demoNote}>
              {S.kelas.demo}
            </span>
          )}
        </span>
        {error && <span className="student__error">{S.kelas.duplicateName}</span>}
      </div>
      <div className="student__consents" role="group" aria-label={`${S.kelas.consent} ${label(s)}`}>
        {CONSENT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="switch"
            className="switch"
            aria-checked={s.consents[key]}
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
          <a className="btn btn--ghost" href={href('bacaan', undefined, { student: s.student_ref })}>
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

function AddStudent() {
  const app = useApp();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ref = addStudent(value);
    if (!ref) {
      setError(value.trim() ? S.kelas.duplicateName : S.kelas.namePlaceholder);
      return;
    }
    toast(S.kelas.added(value.trim(), ref));
    setValue('');
    setError(null);
  };

  return (
    <form className="add" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={inputId}>
        {S.kelas.nameLabel}
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
          placeholder={S.kelas.namePlaceholder}
          autoComplete="off"
          maxLength={24}
          aria-describedby={error ? `${inputId}-error` : undefined}
          aria-invalid={error ? true : undefined}
        />
        <span className="add__code">{nextRef(app.students)}</span>
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

/** CSV of codes and confirmed levels only: no names, no scores, no example data, in code order (CLAUDE.md rules 3 and 7). */
function exportCsv(students: Student[]): void {
  const rows = [['student_ref', 'level', 'confirmed_at', 'session_id', 'rubric']];
  for (const s of students) {
    if (s.level && !s.level.demo) rows.push([s.student_ref, s.level.value, new Date(s.level.confirmed_at).toISOString(), s.level.session_id, s.level.rubric]);
  }
  const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `dengarbaca-tingkat-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
