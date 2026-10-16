import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioBar, type AudioBarHandle } from '../components/AudioBar';
import { Book, PageFoot } from '../components/Book';
import { IconLeft, IconRight } from '../components/Icons';
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
import { addTake, confirmSession, endSession, getAudio, newId, setWordEdit, takesOf, useApp } from '../lib/store';
import { CARD, LEVEL, S, SOURCE, STATUS } from '../strings';
import type { CardLevel, ChildLevel, Session, Source, Take } from '../types';
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
        <h1 className="review__title">{S.review.title}</h1>
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
          return (
            <li key={s.session_id}>
              <a
                className="slist__item"
                href={href('tinjau', s.session_id)}
                aria-current={s.session_id === selectedId ? 'page' : undefined}
              >
                <span className="slist__ref">{s.student_ref}</span>
                <span className="slist__meta">
                  {formatDateTime(s.started_at)}, {S.review.cards(sTakes.length).toLowerCase()}
                </span>
                <span className="slist__chips">
                  {s.simulated && <span className="chip chip--ink">{S.review.simulated}</span>}
                  {s.suggestion?.status !== 'confirmed' && unresolved > 0 && (
                    <span className="chip chip--caution">{S.review.unresolved(unresolved)}</span>
                  )}
                  {s.suggestion?.status === 'confirmed' && s.suggestion.confirmed?.level && (
                    <span className="chip chip--success">{LEVEL[s.suggestion.confirmed.level]}</span>
                  )}
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

  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= takes.length || next === index) return;
      setDir(next > index ? 'forward' : 'back');
      setSelectedWord(null);
      setPlayingMs(null);
      setIndex(next);
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
              {CARD[take.card.level]}, {S.review.pageOf(index + 1, takes.length)}
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
          </div>
          {!isConfirmed && <p className="t-meta">{take.source === 'manual' ? S.review.manualHint : S.review.tapHint}</p>}
        </div>
      </div>

      <div className="sreview__panel">
        <header className="sreview__head">
          <h2 className="t-s5">{session.student_ref}</h2>
          <p className="t-meta">
            {formatDateTime(session.started_at)}, {SOURCE[take.source].toLowerCase()}
          </p>
          {session.simulated && <span className="chip chip--ink">{S.review.simulated}</span>}
        </header>

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
                  <span className="outcome__chips">
                    <span className={`chip ${o.passed ? 'chip--success' : 'chip--neutral'}`}>
                      {o.passed ? S.review.passed : S.review.notPassed}
                    </span>
                    {o.unresolved > 0 && <span className="chip chip--caution">{S.review.unresolved(o.unresolved)}</span>}
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
    else if (level) toast(S.review.confirmedToast(LEVEL[level], session.student_ref));
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
