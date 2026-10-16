import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioBar, type AudioBarHandle } from '../components/AudioBar';
import { Book, PageFoot } from '../components/Book';
import { IconCheck, IconFlag, IconLeft, IconRight } from '../components/Icons';
import { ReadingText } from '../components/ReadingText';
import { toast } from '../components/Toast';
import { WordMenu } from '../components/WordMenu';
import { activitiesFor } from '../lib/activities';
import { cardById, cardFor, cardWords } from '../lib/cards';
import { formatDateTime } from '../lib/format';
import { loadPrefs } from '../lib/prefs';
import { href, navigate } from '../lib/route';
import { CARD_ORDER, RUBRIC, RUBRIC_VERSION, cardOutcome, effectiveStatus, isError, nextCard, suggestLevel } from '../lib/rubric';
import { ENGINE_VERSION, scoreTake } from '../lib/scoring';
import { simulateTokens } from '../lib/simulate';
import { addTake, confirmSession, endSession, getAudio, nameOf, newId, setWordEdit, takesOf, useApp } from '../lib/store';
import { CARD, LEVEL, S, SOURCE, STATUS } from '../strings';
import type { CardLevel, ChildLevel, Session, Source, Take, WordStatus } from '../types';
import './ReviewView.css';

/** How far word timings trail the voice, per source. Used to seek and to box the word being played. */
const LEAD_MS: Record<Source, number> = { online: 700, ondevice: 700, manual: 900, simulated: 0 };

export function ReviewView({ active, sessionId }: { active: boolean; sessionId?: string }) {
  const app = useApp();
  const sessions = useMemo(
    () => [...app.sessions].filter((s) => s.take_ids.length).sort((a, b) => b.started_at - a.started_at),
    [app.sessions],
  );
  const pending = sessions.filter((s) => s.suggestion?.status !== 'confirmed');
  const confirmed = sessions.filter((s) => s.suggestion?.status === 'confirmed');
  const selected = sessions.find((s) => s.session_id === sessionId) ?? null;

  // Open the newest pending reading when nothing is selected.
  useEffect(() => {
    if (active && !sessionId && pending[0]) navigate('tinjau', pending[0].session_id);
  }, [active, sessionId, pending]);

  return (
    <section className="review" aria-label={S.review.title}>
      <aside className="review__list">
        <div className="review__head">
          <h1 className="review__title">{S.review.title}</h1>
          <p className="t-meta">{S.review.intro}</p>
        </div>
        <SessionList title={S.review.pending} sessions={pending} selectedId={sessionId} takes={app.takes} />
        {confirmed.length > 0 && (
          <SessionList title={S.review.confirmed} sessions={confirmed} selectedId={sessionId} takes={app.takes} />
        )}
      </aside>
      <div className="review__main">
        {selected ? (
          <SessionReview key={selected.session_id} session={selected} active={active} />
        ) : (
          <EmptyReview hasSessions={sessions.length > 0} />
        )}
      </div>
    </section>
  );
}

function SessionList({
  title,
  sessions,
  selectedId,
  takes,
}: {
  title: string;
  sessions: Session[];
  selectedId?: string;
  takes: Record<string, Take>;
}) {
  return (
    <div className="slist">
      <h2 className="slist__title">
        {title} <span className="slist__count">{sessions.length}</span>
      </h2>
      <ul>
        {sessions.map((s) => {
          const sTakes = takesOf(s, takes);
          const unresolved = sTakes.reduce((n, t) => n + cardOutcome(t).unresolved, 0);
          const confirmedLevel = s.suggestion?.status === 'confirmed' ? s.suggestion.confirmed?.level : undefined;
          return (
            <li key={s.session_id}>
              <a
                className="slist__item"
                href={href('tinjau', s.session_id)}
                aria-current={s.session_id === selectedId ? 'page' : undefined}
              >
                <span className="slist__ref">
                  {nameOf(s.student_ref)}
                  {s.simulated && <span className="slist__sim">{S.review.simulated}</span>}
                  {s.demo && <span className="slist__sim">{S.review.demo}</span>}
                </span>
                <span className="slist__meta">
                  {formatDateTime(s.started_at)}, {S.review.cards(sTakes.length).toLowerCase()}
                </span>
                <span className="slist__side">
                  {confirmedLevel ? (
                    <span className="chip chip--success">{LEVEL[confirmedLevel]}</span>
                  ) : unresolved > 0 ? (
                    <span className="chip chip--caution">{unresolved}</span>
                  ) : null}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyReview({ hasSessions }: { hasSessions: boolean }) {
  if (hasSessions) return <p className="review__empty-text">{S.review.pickSession}</p>;
  return (
    <div className="review__empty">
      <p className="t-s6">{S.review.empty}</p>
      <p className="t-b8">{S.review.emptyHint}</p>
      <div className="review__empty-actions">
        <a className="btn btn--ghost" href={href('bacaan')}>
          {S.nav.bacaan}
        </a>
        <button type="button" className="btn btn--action" onClick={makeSimulatedSession}>
          {S.review.makeSimulated}
        </button>
      </div>
    </div>
  );
}

/** Builds a full simulated session instantly, stepping down the cards the way Bacaan would. */
function makeSimulatedSession(): void {
  let session: Session = {
    session_id: newId(),
    student_ref: 'SIM-01',
    started_at: Date.now(),
    simulated: true,
    take_ids: [],
  };
  let level: CardLevel | null = RUBRIC.start;
  while (level) {
    const card = cardFor(level);
    const words = cardWords(card);
    const output = scoreTake({
      words,
      heard: simulateTokens(words, `${session.session_id}:${card.id}`),
      supplied: new Set(),
    });
    const take: Take = {
      take_id: newId(),
      session_id: session.session_id,
      student_ref: session.student_ref,
      card: { id: card.id, version: card.version, level },
      source: 'simulated',
      simulated: true,
      created_at: Date.now() + session.take_ids.length,
      quality: { status: 'not_measured' },
      ...output,
      events: [],
      versions: { card: card.version, model: 'simulated@1', engine: ENGINE_VERSION, rubric: RUBRIC_VERSION },
      audio: { stored: false },
      teacher: { edits: {} },
    };
    session = addTake(session, take);
    level = nextCard(level, cardOutcome(take, false).passed);
  }
  endSession(session.session_id);
  navigate('tinjau', session.session_id);
}

interface Flag {
  take: number;
  i: number;
  expected: string;
  heard?: string;
  status: WordStatus;
  open: boolean;
}

const LEGEND: WordStatus[] = ['correct', 'substituted', 'omitted', 'uncertain', 'supplied', 'repeated', 'self_corrected'];

function SessionReview({ session, active }: { session: Session; active: boolean }) {
  const app = useApp();
  const takes = takesOf(session, app.takes);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<'forward' | 'back'>('forward');
  const [selectedWord, setSelectedWord] = useState<number | null>(null);
  const [playingMs, setPlayingMs] = useState<number | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioBarHandle>(null);
  const textSize = useMemo(() => loadPrefs().textSize, []);

  const take = takes[Math.min(index, takes.length - 1)];
  const card = take ? (cardById(take.card.id) ?? cardFor(take.card.level)) : null;
  const words = useMemo(() => (card ? cardWords(card) : []), [card]);
  const student = app.students.find((s) => s.student_ref === session.student_ref);
  const isConfirmed = session.suggestion?.status === 'confirmed';
  const lead = take ? LEAD_MS[take.source] : 0;

  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    if (take?.audio.stored) void getAudio(take.take_id).then((b) => !cancelled && setBlob(b ?? null));
    return () => {
      cancelled = true;
    };
  }, [take?.take_id, take?.audio.stored]);

  /** Opens card `next`, and optionally word `word` on it. */
  const go = useCallback(
    (next: number, word: number | null = null) => {
      if (next < 0 || next >= takes.length) return;
      if (next !== index) {
        setDir(next > index ? 'forward' : 'back');
        setPlayingMs(null);
        setIndex(next);
      }
      setSelectedWord(word);
    },
    [index, takes.length],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (selectedWord !== null) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea, [role="radiogroup"]')) return;
      if (e.key === 'ArrowRight') go(index + 1);
      if (e.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, go, index, selectedWord]);

  // Every word the engine did not hear as plainly correct, across all cards, in reading order.
  const flags: Flag[] = takes.flatMap((t, k) =>
    t.words
      .filter((w) => effectiveStatus(t, w.i) !== 'correct' || w.status !== 'correct')
      .map((w) => ({
        take: k,
        i: w.i,
        expected: w.expected,
        heard: w.heard,
        status: effectiveStatus(t, w.i),
        open: effectiveStatus(t, w.i) === 'uncertain',
      })),
  );
  const openFlags = flags.filter((f) => f.open);

  if (!take || !card) return null;

  const timed = take.words.filter((w) => w.start_ms !== undefined);
  const timelineMs = timed.length ? Math.max(...timed.map((w) => w.start_ms ?? 0)) + 1500 : 0;
  const markers = take.words
    .filter((w) => w.start_ms !== undefined && (isError(effectiveStatus(take, w.i)) || effectiveStatus(take, w.i) === 'uncertain'))
    .map((w) => ({ ms: Math.max(0, (w.start_ms ?? 0) - lead), label: `${w.expected}: ${STATUS[effectiveStatus(take, w.i)]}` }));

  let playing: number | undefined;
  if (playingMs !== null) {
    for (const w of timed) if ((w.start_ms ?? 0) - lead <= playingMs) playing = w.i;
  }

  const audioNote = take.audio.stored
    ? undefined
    : take.audio.deleted_at
      ? S.review.audioDeleted
      : take.simulated && timelineMs
        ? S.review.timelineOnly
        : S.review.noAudio;

  const playWord = (i: number) => {
    const start = take.words[i].start_ms;
    if (start === undefined) return;
    audioRef.current?.playFrom(start - lead - 300, start - lead + 1600);
  };

  const outcomes = takes.map((t) => cardOutcome(t));
  const unresolved = outcomes.reduce((n, o) => n + o.unresolved, 0);
  const suggestion = suggestLevel(takes, true);
  const finalLevel = isConfirmed ? (session.suggestion?.confirmed?.level ?? null) : suggestion.level;

  const nextOpen = () => {
    const after = openFlags.find((f) => f.take > index || (f.take === index && f.i > (selectedWord ?? -1))) ?? openFlags[0];
    if (after) go(after.take, after.i);
  };

  return (
    <div className="sreview">
      <div className="sreview__book">
        <Book
          pageKey={take.take_id}
          direction={dir}
          behind={Math.min(3, takes.length - 1 - index)}
          onNext={index < takes.length - 1 ? () => go(index + 1) : undefined}
          onPrev={index > 0 ? () => go(index - 1) : undefined}
          nextLabel={S.review.nextPage}
          className="book--review"
        >
          <div className="page__body" ref={bodyRef}>
            <ReadingText
              card={card}
              words={words}
              mode="review"
              playing={playing}
              textSize={textSize}
              review={{
                status: (i) => effectiveStatus(take, i),
                edited: (i) => take.teacher.edits[i] !== undefined,
                heard: (i) => {
                  const h = take.words[i]?.heard;
                  return h && h.toLowerCase() !== take.words[i].expected.toLowerCase() ? h : undefined;
                },
                insertions: take.insertions,
                selected: selectedWord ?? undefined,
              }}
              onWordTap={isConfirmed ? undefined : (i) => setSelectedWord((cur) => (cur === i ? null : i))}
            />
            {selectedWord !== null && bodyRef.current && (
              <WordMenu
                take={take}
                i={selectedWord}
                container={bodyRef.current}
                onSet={(status) => setWordEdit(take.take_id, selectedWord, status)}
                onPlay={take.words[selectedWord].start_ms !== undefined && timelineMs ? () => playWord(selectedWord) : undefined}
                onClose={() => setSelectedWord(null)}
              />
            )}
          </div>
          <PageFoot left={card.title} right={index + 1} />
        </Book>

        <div className="sreview__under">
          <AudioBar
            ref={audioRef}
            blob={blob}
            timelineMs={blob ? 0 : timelineMs}
            markers={markers}
            onTime={setPlayingMs}
            note={audioNote}
          />
          <div className="pager">
            <button
              type="button"
              className="btn btn--round"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label={S.review.prevPage}
            >
              <IconLeft size={14} />
            </button>
            <span className="pager__label">
              {CARD[take.card.level]}
              <span className="pager__of">{S.review.pageOf(index + 1, takes.length)}</span>
            </span>
            <button
              type="button"
              className="btn btn--round"
              onClick={() => go(index + 1)}
              disabled={index === takes.length - 1}
              aria-label={S.review.nextPage}
            >
              <IconRight size={14} />
            </button>
            {!isConfirmed && (
              <span className="pager__hint">{take.source === 'manual' ? S.review.manualHint : S.review.tapHint}</span>
            )}
          </div>
          <details className="legend">
            <summary>{S.review.legend}</summary>
            <ul className="legend__list reading--review">
              {LEGEND.map((status) => (
                <li key={status}>
                  <span className="w" data-state={status}>
                    {S.review.legendSample}
                  </span>
                  <span className="legend__name">{STATUS[status]}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>

      <div className="sreview__panel">
        <header className="sreview__head">
          <div className="sreview__who">
            <h2 className="sreview__ref">{nameOf(session.student_ref, app.students)}</h2>
            <span className="sreview__code">{session.student_ref}</span>
            {session.simulated && <span className="chip chip--ink">{S.review.simulated}</span>}
            {session.demo && <span className="chip chip--neutral" title={S.kelas.demoNote}>{S.review.demo}</span>}
          </div>
          <p className="t-meta">
            {formatDateTime(session.started_at)}, {SOURCE[take.source].toLowerCase()}
          </p>
        </header>

        <section className="step" data-done={!isConfirmed && openFlags.length === 0 ? '' : undefined}>
          <h3 className="step__title">
            <span className={`num${isConfirmed || openFlags.length === 0 ? ' is-done' : ' is-on'}`}>
              {isConfirmed || openFlags.length === 0 ? <IconCheck size={12} /> : 1}
            </span>
            {S.review.steps.check}
          </h3>
          <p className="step__text">
            {!flags.length ? S.review.flagsNone : openFlags.length ? S.review.flagsOpen(openFlags.length) : S.review.flagsDone}
          </p>
          {flags.length > 0 && (
            <ul className="flags" aria-label={S.review.flagsList}>
              {flags.map((f) => (
                <li key={`${f.take}:${f.i}`}>
                  <button
                    type="button"
                    className="flag"
                    data-open={f.open ? '' : undefined}
                    aria-current={f.take === index && f.i === selectedWord ? 'true' : undefined}
                    disabled={isConfirmed}
                    onClick={() => go(f.take, f.i)}
                  >
                    <span className="flag__word">{f.expected}</span>
                    <span className="flag__heard">{f.heard ? S.review.heardAs(f.heard) : S.review.notHeard}</span>
                    <span className="flag__status" data-state={f.status}>
                      {STATUS[f.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!isConfirmed && openFlags.length > 0 && (
            <button type="button" className="btn btn--action" onClick={nextOpen}>
              <IconFlag size={14} />
              {S.review.nextFlag}
            </button>
          )}
        </section>

        <section className="step">
          <h3 className="step__title">
            <span className="num">2</span>
            {S.review.steps.cards}
          </h3>
          <ol className="outcomes">
            {takes.map((t, k) => {
              const o = outcomes[k];
              return (
                <li key={t.take_id}>
                  <button
                    type="button"
                    className="outcome"
                    aria-current={k === index ? 'true' : undefined}
                    onClick={() => go(k)}
                  >
                    <span className="outcome__name">{CARD[t.card.level]}</span>
                    <span className="outcome__line">
                      {S.review.cardLine(o.correct, o.total)}, {S.review.passLine(o.needed)}
                    </span>
                    <span className={`chip ${o.passed ? 'chip--success' : 'chip--neutral'} outcome__chip`}>
                      {o.passed ? S.review.passed : S.review.notPassed}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {take.fluency.wcpm !== null && take.fluency.reading_time_s !== null && (
            <p className="t-meta">
              {S.review.fluency(take.fluency.reading_time_s, take.fluency.wcpm)}. {S.review.fluencyNote}
              {take.insertions.length > 0 && ` ${S.review.insertions(take.insertions.length)}.`}
            </p>
          )}
        </section>

        <section className="step step--decide">
          <h3 className="step__title">
            <span className={`num${isConfirmed ? ' is-done' : openFlags.length ? '' : ' is-on'}`}>
              {isConfirmed ? <IconCheck size={12} /> : 3}
            </span>
            {S.review.steps.decide}
          </h3>
          <div className="verdict">
            <p className="verdict__label">{isConfirmed ? S.review.level : S.review.suggested}</p>
            {finalLevel ? (
              <p className="verdict__level">{LEVEL[finalLevel]}</p>
            ) : (
              <p className="verdict__none">
                {suggestion.missing ? S.review.noLevel(CARD[suggestion.missing]) : '—'}
              </p>
            )}
            <div className="verdict__chips">
              <span className={`chip ${isConfirmed ? 'chip--success' : 'chip--caution'}`}>
                {isConfirmed ? S.review.confirmedChip : S.review.pendingChip}
              </span>
              <span className="t-meta">{isConfirmed ? session.suggestion?.confirmed?.rule : suggestion.rule}</span>
            </div>
          </div>

          {!isConfirmed && (
            <ConfirmArea
              session={session}
              unresolved={unresolved}
              level={suggestion.level}
              missing={suggestion.missing}
              keepAudio={Boolean(student?.consents.audio_research)}
              hasAudio={takes.some((t) => t.audio.stored)}
            />
          )}

          {isConfirmed && session.simulated && <p className="t-b8">{S.review.simulatedNote}</p>}
          {isConfirmed && !session.simulated && finalLevel && <Activities level={finalLevel} />}
        </section>

        <details className="rules">
          <summary>{S.review.rules}</summary>
          <ul>
            {CARD_ORDER.map((l) => (
              <li key={l}>
                <span>{RUBRIC.cards[l].rule}</span> {CARD[l]}: ≥ {Math.round(RUBRIC.cards[l].min_accuracy * 100)}%
              </li>
            ))}
            <li>
              <span>{RUBRIC.beginner_rule}</span> {LEVEL.pemula}: {CARD.huruf.toLowerCase()} {S.review.notPassed.toLowerCase()}
            </li>
          </ul>
          <p>{S.review.errorsCount}</p>
          <p>{S.review.rulesNote}</p>
        </details>
      </div>
    </div>
  );
}

function ConfirmArea({
  session,
  unresolved,
  level,
  missing,
  keepAudio,
  hasAudio,
}: {
  session: Session;
  unresolved: number;
  level: ChildLevel | null;
  missing: CardLevel | null;
  keepAudio: boolean;
  hasAudio: boolean;
}) {
  const confirm = () => {
    confirmSession(session.session_id);
    if (session.simulated) toast(S.review.simulatedToast);
    else if (level) toast(S.review.confirmedToast(LEVEL[level], nameOf(session.student_ref)));
    else toast(S.review.closedToast);
  };

  return (
    <div className="confirm">
      {unresolved > 0 && <p className="desk__notice">{S.review.needsReview(unresolved)}</p>}
      {!level && missing && !session.simulated && (
        <a
          className="btn btn--ghost"
          href={href('bacaan', undefined, { student: session.student_ref, card: missing })}
        >
          {S.review.startMissing(CARD[missing])}
        </a>
      )}
      <button type="button" className="btn btn--cta" disabled={unresolved > 0} onClick={confirm}>
        {session.simulated
          ? S.review.confirmSimulated
          : level
            ? S.review.confirm(LEVEL[level])
            : S.review.closeWithout}
      </button>
      {hasAudio && !session.simulated && (
        <p className="t-meta">{keepAudio ? S.review.audioWillKeep : S.review.audioWillDelete}</p>
      )}
    </div>
  );
}

function Activities({ level }: { level: ChildLevel }) {
  const list = activitiesFor(level);
  return (
    <div className="acts">
      <p className="verdict__label">
        {S.review.group}: {LEVEL[level]}
      </p>
      <p className="t-s7">{S.review.activities}</p>
      <ul className="acts__list">
        {list.map((a) => (
          <li key={a.id}>
            <span className="acts__title">{a.title}</span>
            <span className="t-meta">
              {S.kelas.minutes(a.minutes)}. {S.kelas.activityDraft}.
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
