import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Book, PageFoot } from '../components/Book';
import { IconMic, IconStop, IconTextSize } from '../components/Icons';
import { MicLine } from '../components/MicLine';
import { ReadingText } from '../components/ReadingText';
import { toast } from '../components/Toast';
import { startCapture, type Capture } from '../lib/audio';
import { cardFor, cardWords } from '../lib/cards';
import { loadPrefs, savePrefs, type TextSize } from '../lib/prefs';
import { navigate, useRoute } from '../lib/route';
import { CARD_ORDER, RUBRIC, RUBRIC_VERSION, cardOutcome, nextCard } from '../lib/rubric';
import { ENGINE_VERSION, liveCursor, manualTake, normalize, scoreTake, type HeardToken } from '../lib/scoring';
import { simulationScript, SimulatedStream } from '../lib/simulate';
import { ManualStream, OnDeviceStream, installOnDevice, onDeviceStatus, type HeardStream, type OnDeviceStatus } from '../lib/speech';
import { addTake, endSession, newId, useApp } from '../lib/store';
import { CARD, S, SOURCE } from '../strings';
import type { CardLevel, LiveEvent, Session, Source, Take } from '../types';
import './ReadView.css';

type Phase =
  | { kind: 'ready' }
  | { kind: 'card'; level: CardLevel; step: 'armed' | 'listening' | 'saving' }
  | { kind: 'thanks'; takeId: string; ended: boolean };

const STALL_MS = 3000;
const AUTO_FINISH_MS = 1400;

const MODEL: Record<Source, string> = {
  ondevice: 'webspeech-ondevice-id',
  manual: 'manual',
  simulated: 'simulated@1',
};

interface Live {
  stream: HeardStream | null;
  capture: Capture | null;
  source: Source;
  t0: number;
  events: LiveEvent[];
  times: Map<number, number>;
  supplied: Set<number>;
  tokens: HeardToken[];
  cursor: number;
  lastAdvance: number;
  /** Word the stall prompt was raised for, so it is logged once. */
  stalledOn: number | null;
  finishTimer: number;
}

function freshLive(source: Source): Live {
  return {
    stream: null,
    capture: null,
    source,
    t0: performance.now(),
    events: [],
    times: new Map(),
    supplied: new Set(),
    tokens: [],
    cursor: 0,
    lastAdvance: performance.now(),
    stalledOn: null,
    finishTimer: 0,
  };
}

export function ReadView({ active }: { active: boolean }) {
  const app = useApp();
  const route = useRoute();
  const initialPrefs = useMemo(loadPrefs, []);
  const [source, setSource] = useState<Source>(initialPrefs.source);
  const [textSize, setTextSize] = useState<TextSize>(initialPrefs.textSize);
  const [onDevice, setOnDevice] = useState<OnDeviceStatus>('unsupported');
  const [installing, setInstalling] = useState(false);
  const [studentRef, setStudentRef] = useState<string | null>(null);
  const [startLevel, setStartLevel] = useState<CardLevel>(RUBRIC.start);
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const [cursor, setCursor] = useState(0);
  const [stall, setStall] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState<{ key: string; no: number; dir: 'forward' | 'back' }>({ key: 'cover', no: 0, dir: 'forward' });
  const run = useRef<{ session: Session; source: Source } | null>(null);
  const live = useRef<Live>(freshLive('manual'));
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const stageRef = useRef<HTMLElement>(null);

  const student = app.students.find((s) => s.student_ref === studentRef) ?? null;
  const level: CardLevel | null =
    phase.kind === 'card' ? phase.level : phase.kind === 'thanks' ? (app.takes[phase.takeId]?.card.level ?? null) : null;
  const card = level ? cardFor(level) : null;
  const words = useMemo(() => (card ? cardWords(card) : []), [card]);
  const norms = useMemo(() => words.map((w) => w.norm), [words]);
  const listening = phase.kind === 'card' && phase.step === 'listening';

  // Recognizer availability, checked once.
  useEffect(() => {
    void onDeviceStatus().then((status) => {
      setOnDevice(status);
      if (status !== 'available') setSource((s) => (s === 'ondevice' ? 'manual' : s));
    });
  }, []);

  // #/bacaan?student=K2-03&card=kata preselects a student and a start card.
  useEffect(() => {
    if (!active || phaseRef.current.kind !== 'ready') return;
    const ref = route.params.get('student');
    const startCard = route.params.get('card') as CardLevel | null;
    if (ref) setStudentRef(ref);
    if (startCard && CARD_ORDER.includes(startCard)) setStartLevel(startCard);
  }, [active, route.params]);

  // A deleted student cannot stay selected.
  useEffect(() => {
    if (studentRef && app.ready && !student && phase.kind === 'ready') setStudentRef(null);
  }, [app.ready, phase.kind, student, studentRef]);

  const turn = useCallback((key: string, dir: 'forward' | 'back' = 'forward', reset = false) => {
    setPage((p) => ({ key, no: reset ? 0 : p.no + 1, dir }));
  }, []);

  // A page turn scrolls the book back into view if the teacher had scrolled down to the controls.
  useEffect(() => {
    const top = stageRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) {
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    }
  }, [page.key]);

  const moveCursor = useCallback(
    (next: number) => {
      const l = live.current;
      const now = Math.round(performance.now() - l.t0);
      if (next > l.cursor) {
        for (let i = l.cursor; i < next; i++) {
          l.events.push({ t_ms: now, type: 'word_ended', i });
          if (!l.times.has(i)) l.times.set(i, now);
        }
        l.lastAdvance = performance.now();
        l.stalledOn = null;
        setStall(null);
      } else if (next < l.cursor) {
        l.events.push({ t_ms: now, type: 'went_back', i: next });
      }
      l.cursor = next;
      setCursor(next);
      window.clearTimeout(l.finishTimer);
      if (next >= words.length && words.length) {
        l.finishTimer = window.setTimeout(() => void finishRef.current(), AUTO_FINISH_MS);
      }
    },
    [words.length],
  );

  const onLive = useCallback(
    (tokens: HeardToken[]) => {
      const l = live.current;
      l.tokens = tokens;
      const heard = tokens.map((t) => normalize(t.text)).filter(Boolean);
      moveCursor(liveCursor(norms, heard, l.supplied));
    },
    [moveCursor, norms],
  );

  const openCard = useCallback(
    (next: CardLevel) => {
      if (!student) return;
      if (!run.current) {
        const takeSource = source === 'simulated' ? 'simulated' : student.consents.assessment ? source : 'manual';
        run.current = {
          source: takeSource,
          session: {
            session_id: newId(),
            student_ref: student.student_ref,
            started_at: Date.now(),
            simulated: takeSource === 'simulated',
            take_ids: [],
          },
        };
      }
      live.current = freshLive(run.current.source);
      setCursor(0);
      setStall(null);
      setElapsed(0);
      setNotice(null);
      setPhase({ kind: 'card', level: next, step: 'armed' });
      turn(`card:${next}:${newId()}`);
    },
    [source, student, turn],
  );

  const startListening = useCallback(async () => {
    const r = run.current;
    if (!r || !student || !card) return;
    const l = freshLive(r.source);
    live.current = l;
    const record = r.source !== 'simulated' && student.consents.assessment;
    if (record) {
      try {
        l.capture = await startCapture();
      } catch (error) {
        const denied = error instanceof DOMException && error.name === 'NotAllowedError';
        setNotice(denied ? S.reading.micDenied : S.reading.micMissing);
        l.source = 'manual';
      }
    }
    if (l.source === 'ondevice') l.stream = new OnDeviceStream();
    else if (l.source === 'simulated') {
      const seed = `${r.session.session_id}:${card.id}:${r.session.take_ids.length}`;
      const sim = new SimulatedStream(simulationScript(words, seed));
      void sim.finished.then(() => {
        const p = phaseRef.current;
        if (p.kind === 'card' && p.step === 'listening') window.setTimeout(() => void finishRef.current(), 900);
      });
      l.stream = sim;
    } else l.stream = new ManualStream();

    l.t0 = performance.now();
    l.lastAdvance = l.t0;
    l.stream.start(onLive, () => {
      setNotice(S.reading.recognizerFailed);
      live.current.source = 'manual';
    });
    setPhase({ kind: 'card', level: card.level, step: 'listening' });
  }, [card, onLive, student, words]);

  const finish = useCallback(async () => {
    const p = phaseRef.current;
    const r = run.current;
    if (p.kind !== 'card' || p.step !== 'listening' || !r || !card) return;
    setPhase({ ...p, step: 'saving' });
    const l = live.current;
    window.clearTimeout(l.finishTimer);
    const tokens = (await l.stream?.stop()) ?? [];
    const recording = l.capture ? await l.capture.stop().catch(() => null) : null;
    const output =
      l.source === 'manual'
        ? manualTake(words, l.supplied, l.times)
        : scoreTake({ words, heard: tokens, supplied: l.supplied });
    const take: Take = {
      take_id: newId(),
      session_id: r.session.session_id,
      student_ref: r.session.student_ref,
      card: { id: card.id, version: card.version, level: card.level },
      source: l.source,
      simulated: r.session.simulated,
      created_at: Date.now(),
      quality: recording?.quality ?? { status: 'not_measured' },
      words: output.words,
      insertions: output.insertions,
      fluency: output.fluency,
      events: l.events,
      versions: { card: card.version, model: MODEL[l.source], engine: ENGINE_VERSION, rubric: RUBRIC_VERSION },
      audio: recording ? { stored: true, duration_ms: recording.duration_ms } : { stored: false },
      teacher: { edits: {} },
    };
    r.session = addTake(r.session, take, recording?.wav);
    setStall(null);
    setPhase({ kind: 'thanks', takeId: take.take_id, ended: false });
    turn(`thanks:${take.take_id}`);
  }, [card, turn, words]);

  const finishRef = useRef(finish);
  finishRef.current = finish;

  const cancelTake = useCallback(() => {
    const l = live.current;
    window.clearTimeout(l.finishTimer);
    l.stream?.cancel();
    l.capture?.cancel();
    live.current = freshLive(l.source);
    setCursor(0);
    setStall(null);
    const p = phaseRef.current;
    if (p.kind === 'card') setPhase({ ...p, step: 'armed' });
  }, []);

  // Leaving the page mid-reading stops the microphone.
  useEffect(() => {
    if (!active && phaseRef.current.kind === 'card' && phaseRef.current.step === 'listening') {
      cancelTake();
      toast(S.reading.cancelled);
    }
  }, [active, cancelTake]);

  // Timer and the 3 s stall prompt (teacher-only, CLAUDE.md rule 5).
  useEffect(() => {
    if (!listening) return;
    const id = window.setInterval(() => {
      const l = live.current;
      setElapsed(performance.now() - l.t0);
      if (l.source === 'manual' || l.cursor >= words.length) return;
      const quiet = performance.now() - l.lastAdvance;
      if (quiet > STALL_MS && l.stalledOn !== l.cursor) {
        l.stalledOn = l.cursor;
        l.events.push({ t_ms: Math.round(performance.now() - l.t0), type: 'stalled', i: l.cursor, ms: Math.round(quiet) });
        setStall(l.cursor);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [listening, words.length]);

  // Penanda guru: Space or → moves the highlight on, ← moves it back.
  useEffect(() => {
    if (!listening || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (live.current.source !== 'manual') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        moveCursor(Math.min(live.current.cursor + 1, words.length));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveCursor(Math.max(live.current.cursor - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, listening, moveCursor, words.length]);

  const supplyWord = () => {
    const l = live.current;
    if (stall === null) return;
    l.supplied.add(stall);
    l.events.push({ t_ms: Math.round(performance.now() - l.t0), type: 'supplied', i: stall });
    l.stream?.supply?.(stall);
    setStall(null);
    onLive(l.tokens);
  };

  const endRun = () => {
    const r = run.current;
    if (!r || phase.kind !== 'thanks') return;
    endSession(r.session.session_id);
    setPhase({ ...phase, ended: true });
  };

  const nextStudent = () => {
    run.current = null;
    setStudentRef(null);
    setStartLevel(RUBRIC.start);
    setPhase({ kind: 'ready' });
    setNotice(null);
    turn('cover', 'back', true);
  };

  const backToCover = () => {
    if (run.current && !run.current.session.take_ids.length) run.current = null;
    setPhase({ kind: 'ready' });
    turn('cover', 'back', true);
  };

  const chooseSource = (next: Source) => {
    setSource(next);
    savePrefs({ source: next });
  };

  const cycleTextSize = () => {
    const next = ((textSize + 1) % 3) as TextSize;
    setTextSize(next);
    savePrefs({ textSize: next });
  };

  const install = async () => {
    setInstalling(true);
    const ok = await installOnDevice();
    setInstalling(false);
    const status = await onDeviceStatus();
    setOnDevice(status);
    if (ok && status === 'available') chooseSource('ondevice');
  };

  // Pages fanned behind the front page: the cards still to come, or the book's thickness.
  const remaining = level ? CARD_ORDER.length - CARD_ORDER.indexOf(level) - 1 : 3;
  const behind = phase.kind === 'ready' ? 3 : Math.min(3, Math.max(1, remaining));

  const thanksTake = phase.kind === 'thanks' ? app.takes[phase.takeId] : undefined;

  return (
    <section className="read" aria-label={S.nav.bacaan} ref={stageRef}>
      <Book pageKey={page.key} direction={page.dir} dark={phase.kind === 'ready'} behind={behind}>
        {phase.kind === 'ready' && (
          <Cover
            students={app.students.map((s) => s.student_ref)}
            selected={studentRef}
            onSelect={setStudentRef}
            startLevel={startLevel}
            onStartLevel={setStartLevel}
          />
        )}
        {phase.kind === 'card' && card && (
          <>
            <div className="page__body">
              <ReadingText
                card={card}
                words={words}
                mode="tes"
                cursor={cursor}
                textSize={textSize}
                onWordTap={listening && live.current.source === 'manual' ? moveCursor : undefined}
              />
            </div>
            <PageFoot left={card.title} right={page.no} />
          </>
        )}
        {phase.kind === 'thanks' && card && (
          <>
            <div className="page__body thanks">
              <p className="thanks__title">{S.thanks.title}</p>
              <p className="thanks__body">{S.thanks.body}</p>
            </div>
            <PageFoot left={card.title} right={page.no} />
          </>
        )}
      </Book>

      <div className="desk">
        {phase.kind === 'ready' && (
          <ReadyDesk
            source={source}
            onSource={chooseSource}
            onDevice={onDevice}
            installing={installing}
            onInstall={install}
            studentRef={studentRef}
            noConsent={Boolean(student && !student.consents.assessment && source !== 'simulated')}
            onOpen={() => openCard(startLevel)}
          />
        )}

        {phase.kind === 'card' && (
          <>
            <MicLine
              active={listening}
              level={() => live.current.stream?.level?.() ?? live.current.capture?.level() ?? 0}
            />
            {phase.step === 'armed' && (
              <div className="desk__row">
                <button type="button" className="btn btn--cta" onClick={() => void startListening()}>
                  <IconMic />
                  {S.reading.start}
                </button>
                <button type="button" className="btn btn--ghost" onClick={backToCover}>
                  {S.reading.back}
                </button>
                <TextSizeButton size={textSize} onClick={cycleTextSize} />
              </div>
            )}
            {phase.step === 'listening' && (
              <div className="desk__row">
                <span className="desk__timer" aria-live="off">
                  <span className="desk__dot" aria-hidden="true" />
                  {live.current.source === 'manual' ? S.reading.marking : S.reading.listening}{' '}
                  {formatClock(elapsed)}
                </span>
                <button type="button" className="btn btn--action" onClick={() => void finish()}>
                  <IconStop size={14} />
                  {S.reading.stop}
                </button>
                <TextSizeButton size={textSize} onClick={cycleTextSize} />
              </div>
            )}
            {phase.step === 'saving' && <p className="desk__hint">{S.reading.scoring}</p>}
            {stall !== null && listening && (
              <div className="stall" role="alert">
                <span>{S.reading.stalled(words[stall]?.text.replace(/[.,!?]/g, '') ?? '')}</span>
                <button type="button" className="btn btn--action" onClick={supplyWord}>
                  {S.reading.supplied}
                </button>
              </div>
            )}
            {notice && <p className="desk__notice">{notice}</p>}
            {phase.step !== 'saving' && (
              <p className="desk__hint">
                {run.current?.session.simulated && <span className="chip chip--ink">{S.reading.simulatedChip}</span>}
                {live.current.source === 'manual' ? S.engine.manual : phase.step === 'armed' ? S.reading.armedHint : null}
              </p>
            )}
          </>
        )}

        {phase.kind === 'thanks' && thanksTake && (
          <NextCardDesk
            take={thanksTake}
            ended={phase.ended}
            studentRef={thanksTake.student_ref}
            onOpen={openCard}
            onEnd={endRun}
            onNextStudent={nextStudent}
          />
        )}
      </div>
    </section>
  );
}

function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TextSizeButton({ size, onClick }: { size: TextSize; onClick: () => void }) {
  return (
    <button type="button" className="btn btn--ghost text-size" onClick={onClick} aria-label={`${S.reading.textSize} ${size + 1} / 3`}>
      <IconTextSize />
      <span className="text-size__steps" aria-hidden="true">
        {[0, 1, 2].map((k) => (
          <span key={k} className={k <= size ? 'is-on' : undefined} />
        ))}
      </span>
    </button>
  );
}

interface CoverProps {
  students: string[];
  selected: string | null;
  onSelect: (ref: string) => void;
  startLevel: CardLevel;
  onStartLevel: (level: CardLevel) => void;
}

/** Siap membaca: the dark cover where the teacher picks the reader and the first card. */
function Cover({ students, selected, onSelect, startLevel, onStartLevel }: CoverProps) {
  return (
    <div className="page__body cover">
      <p className="cover__brand">{S.brand}</p>
      <h1 className="cover__title">{S.ready.title}</h1>

      <div className="cover__group">
        <p className="cover__label" id="pick-student">
          {S.ready.pick}
        </p>
        {students.length ? (
          <div className="cover__students" role="radiogroup" aria-labelledby="pick-student">
            {students.map((ref) => (
              <button
                key={ref}
                type="button"
                role="radio"
                aria-checked={selected === ref}
                className="cover__student"
                onClick={() => onSelect(ref)}
              >
                {ref}
              </button>
            ))}
          </div>
        ) : (
          <p className="cover__empty">
            {S.ready.noStudents}{' '}
            <a href="#/kelas" className="cover__link">
              {S.ready.toKelas}
            </a>
          </p>
        )}
      </div>

      <div className="cover__group">
        <p className="cover__label" id="pick-card">
          {S.ready.startFrom}
        </p>
        <ol className="cover__toc" role="radiogroup" aria-labelledby="pick-card">
          {CARD_ORDER.map((lvl, k) => (
            <li key={lvl}>
              <button
                type="button"
                role="radio"
                aria-checked={startLevel === lvl}
                className="cover__entry"
                onClick={() => onStartLevel(lvl)}
              >
                <span className="cover__num">{k + 1}</span>
                <span className="cover__name">{CARD[lvl]}</span>
                <span className="cover__leader" aria-hidden="true" />
                <span className="cover__card">{cardFor(lvl).title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

interface ReadyDeskProps {
  source: Source;
  onSource: (s: Source) => void;
  onDevice: OnDeviceStatus;
  installing: boolean;
  onInstall: () => void;
  studentRef: string | null;
  noConsent: boolean;
  onOpen: () => void;
}

function ReadyDesk({ source, onSource, onDevice, installing, onInstall, studentRef, noConsent, onOpen }: ReadyDeskProps) {
  const sources: Source[] = ['ondevice', 'manual', 'simulated'];
  const engineNote =
    source === 'ondevice' ? S.engine.ondevice[onDevice] : source === 'manual' ? S.engine.manual : S.engine.simulated;
  return (
    <>
      <div className="desk__row desk__row--split">
        <div className="seg" role="radiogroup" aria-label={S.engine.label}>
          {sources.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={source === s}
              className="seg__opt"
              disabled={s === 'ondevice' && onDevice !== 'available' && onDevice !== 'downloadable'}
              onClick={() => onSource(s)}
            >
              {SOURCE[s]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--cta"
          onClick={onOpen}
          disabled={!studentRef || (source === 'ondevice' && onDevice !== 'available')}
        >
          {studentRef ? S.ready.open : S.ready.pickFirst}
        </button>
      </div>
      <p className="desk__hint">
        {source !== 'ondevice' && onDevice !== 'available' ? (
          <>
            {engineNote} <span className="desk__aside">{S.engine.ondevice[onDevice]}</span>
          </>
        ) : (
          engineNote
        )}
      </p>
      {onDevice === 'downloadable' && (
        <button type="button" className="btn btn--ghost" onClick={onInstall} disabled={installing}>
          {installing ? S.engine.installing : S.engine.install}
        </button>
      )}
      {noConsent && studentRef && <p className="desk__notice">{S.ready.noConsent(studentRef)}</p>}
    </>
  );
}

interface NextCardDeskProps {
  take: Take;
  ended: boolean;
  studentRef: string;
  onOpen: (level: CardLevel) => void;
  onEnd: () => void;
  onNextStudent: () => void;
}

/** Kartu berikutnya: the teacher's choice after each card. Provisional, from the engine alone. */
function NextCardDesk({ take, ended, studentRef, onOpen, onEnd, onNextStudent }: NextCardDeskProps) {
  if (ended) {
    return (
      <>
        <p className="desk__lead">{S.done.pending(studentRef)}</p>
        <div className="desk__row">
          <button type="button" className="btn btn--cta" onClick={onNextStudent}>
            {S.done.nextStudent}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('tinjau', take.session_id)}>
            {S.done.review}
          </button>
        </div>
      </>
    );
  }

  const outcome = take.source === 'manual' ? null : cardOutcome(take, false);
  const suggested = outcome ? nextCard(take.card.level, outcome.passed) : null;
  const quality = take.quality;
  const lowSpeech = quality.status === 'retry_suggested' && (quality.speech_ratio ?? 1) < 0.15;
  const others = CARD_ORDER.filter((l) => l !== take.card.level && l !== suggested);

  return (
    <>
      {quality.status === 'retry_suggested' && (
        <p className="desk__notice">
          {lowSpeech ? S.next.quality(Math.round((quality.speech_ratio ?? 0) * 100)) : S.next.clipping}
        </p>
      )}
      {outcome && (
        <p className="desk__lead">
          <span className="desk__label">{S.next.suggestion}</span>{' '}
          {suggested ? CARD[suggested] : S.next.stopHere}
        </p>
      )}
      {!outcome && <p className="desk__hint">{S.next.whyManual}</p>}
      <div className="desk__row">
        {suggested && (
          <button type="button" className="btn btn--cta" onClick={() => onOpen(suggested)}>
            {S.next.continueTo(CARD[suggested])}
          </button>
        )}
        <button type="button" className={outcome && !suggested ? 'btn btn--cta' : 'btn btn--ghost'} onClick={onEnd}>
          {S.next.finish(studentRef)}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => onOpen(take.card.level)}>
          {S.next.retry}
        </button>
        <label className="desk__other">
          <span className="visually-hidden">{S.next.otherCard}</span>
          <select
            className="select"
            value=""
            onChange={(e) => e.target.value && onOpen(e.target.value as CardLevel)}
          >
            <option value="">{outcome ? S.next.otherCard : S.next.manualPick}</option>
            {(outcome ? others : CARD_ORDER.filter((l) => l !== take.card.level)).map((l) => (
              <option key={l} value={l}>
                {CARD[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {outcome && (
        <details className="desk__why">
          <summary>{S.next.why}</summary>
          <p>{S.next.whyEngine(outcome.correct, outcome.total, outcome.needed, outcome.rule)}</p>
        </details>
      )}
    </>
  );
}
