import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Book, PageFoot } from '../components/Book';
import { IconCheck, IconLeft, IconMic, IconStop, IconTextSize } from '../components/Icons';
import { Ladder } from '../components/Ladder';
import { ListenButton } from '../components/ListenButton';
import { SketchStars, Trail } from '../components/Trail';
import { ReadingText } from '../components/ReadingText';
import { toast } from '../components/Toast';
import { WordModal } from '../components/WordModal';
import { startCapture, type Capture } from '../lib/audio';
import { cardFor, cardWords } from '../lib/cards';
import { loadPrefs, savePrefs, type TextSize } from '../lib/prefs';
import { nextToRead, stageOf } from '../lib/progress';
import { navigate, useRoute } from '../lib/route';
import { CARD_ORDER, RUBRIC, RUBRIC_VERSION, cardOutcome, nextCard } from '../lib/rubric';
import { ENGINE_VERSION, liveCursor, manualTake, normalize, scoreTake, type HeardToken } from '../lib/scoring';
import { simulationScript, SimulatedStream } from '../lib/simulate';
import {
  ManualStream,
  WebSpeechStream,
  onlineStatus,
  type HeardStream,
  type OnlineStatus,
  type RecognizerHealth,
  type TranscriptSegment,
} from '../lib/speech';
import { NucleusDetector, syllableCount } from '../lib/syllables';
import { addTake, endSession, nameOf, newId, useApp } from '../lib/store';
import { CARD, LEVEL, S, SOURCE } from '../strings';
import type { CardLevel, LiveEvent, Session, Source, Student, Take } from '../types';
import './ReadView.css';

type Phase =
  | { kind: 'ready' }
  | { kind: 'card'; level: CardLevel; step: 'armed' | 'listening' | 'saving' }
  | { kind: 'thanks'; takeId: string; ended: boolean };

const STALL_MS = 3000;
const AUTO_FINISH_MS = 1400;
/** Syllables voiced with no recognized word before the teacher is told the recognizer is silent. */
const SILENT_RECOGNIZER_SYLLABLES = 8;
/** The box steps through words the recognizer delivers in one burst, instead of jumping. */
const CATCH_UP_MS = 70;

const MODEL: Record<Source, string> = {
  online: 'webspeech-cloud-id',
  ondevice: 'webspeech-ondevice-id',
  manual: 'manual',
  simulated: 'simulated@1',
};

/** Sources whose highlight follows recognized words. */
const recognizes = (s: Source) => s === 'online' || s === 'ondevice';

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
  /** Voice activity from the microphone signal; null without a microphone. It never moves the highlight. */
  detector: NucleusDetector | null;
  voiced: boolean;
  syllables: number;
  /** Words the recognizer has heard so far. */
  asrHeard: number;
  /** The teacher was told the recognizer hears nothing, so it is said once. */
  silentWarned: boolean;
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
    detector: null,
    voiced: false,
    syllables: 0,
    asrHeard: 0,
    silentWarned: false,
  };
}

export function ReadView({ active }: { active: boolean }) {
  const app = useApp();
  const route = useRoute();
  const initialPrefs = useMemo(loadPrefs, []);
  const [source, setSource] = useState<Source>(initialPrefs.source);
  const [textSize, setTextSize] = useState<TextSize>(initialPrefs.textSize);
  const [online, setOnline] = useState<OnlineStatus>(onlineStatus);
  const [studentRef, setStudentRef] = useState<string | null>(null);
  const [startLevel, setStartLevel] = useState<CardLevel>(RUBRIC.start);
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const [cursor, setCursor] = useState(0);
  const [shownCursor, setShownCursor] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [tracking, setTracking] = useState<{ syllables: number; health: RecognizerHealth | null } | null>(null);
  const [stall, setStall] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState<{ key: string; no: number; dir: 'forward' | 'back' }>({ key: 'cover', no: 0, dir: 'forward' });
  const [kbbiTarget, setKbbiTarget] = useState<{ word: string; anchor: HTMLElement } | null>(null);
  const enterTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
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
  const totalSyllables = useMemo(() => words.reduce((n, w) => n + syllableCount(w.norm), 0), [words]);
  const listening = phase.kind === 'card' && phase.step === 'listening';
  // Raw recognizer output under the book: always in `npm run dev`, or with ?debug=1.
  const debug = import.meta.env.DEV || route.params.get('debug') === '1';

  useEffect(() => {
    if (shownCursor > cursor) {
      setShownCursor(cursor);
      return;
    }
    if (shownCursor === cursor) return;
    const behind = cursor - shownCursor;
    const id = window.setTimeout(() => setShownCursor((s) => Math.min(s + 1, cursor)), Math.max(30, CATCH_UP_MS - 8 * behind));
    return () => window.clearTimeout(id);
  }, [cursor, shownCursor]);

  // The online recognizer needs a browser that has one and a connection.
  useEffect(() => {
    const update = () => setOnline(onlineStatus());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // The on-device recognizer is parked for the web MVP: Chrome rejects its Bahasa Indonesia pack.
  useEffect(() => {
    if (source === 'ondevice') setSource(onlineStatus() === 'unsupported' ? 'manual' : 'online');
  }, [source]);

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

  /** Moves the highlight forward to `target`, never back. */
  const advance = useCallback(
    (target: number) => {
      const next = Math.max(live.current.cursor, Math.min(target, words.length));
      if (next !== live.current.cursor) moveCursor(next);
    },
    [moveCursor, words.length],
  );

  /** The teacher puts the highlight on word `i` (tap, Space or arrow keys). */
  const placeAt = useCallback((i: number) => moveCursor(Math.max(0, Math.min(i, words.length))), [moveCursor, words.length]);

  /** Every 10 ms of microphone signal: voice activity only. It never moves the highlight. */
  const onFrame = useCallback((rms: number, zcr: number) => {
    const l = live.current;
    if (!l.detector) return;
    const { voiced, nucleusAt } = l.detector.push(rms, zcr);
    if (voiced && !l.voiced) {
      // The reader has started; the stall clock starts now, not when the teacher pressed Mulai.
      l.voiced = true;
      l.lastAdvance = performance.now();
    }
    if (nucleusAt !== null) l.syllables++;
  }, []);

  /** Recognized words move the highlight. Nothing else does. */
  const onLive = useCallback(
    (tokens: HeardToken[]) => {
      const l = live.current;
      l.tokens = tokens;
      const heard = tokens.map((t) => normalize(t.text)).filter(Boolean);
      l.asrHeard = heard.length;
      // The recognizer revises its guesses; the highlight only ever moves forward on them.
      advance(liveCursor(norms, heard, l.supplied));
      if (debug) setTranscript(l.stream?.segments?.() ?? [{ text: tokens.map((t) => t.text).join(' '), final: true }]);
    },
    [advance, debug, norms],
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
      setTranscript([]);
      setTracking(null);
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
    setTranscript([]);
    setTracking(null);
    const record = r.source !== 'simulated' && student.consents.assessment;
    if (record) {
      try {
        l.capture = await startCapture();
        l.detector = new NucleusDetector();
        l.capture.onFrame = onFrame;
      } catch (error) {
        const denied = error instanceof DOMException && error.name === 'NotAllowedError';
        setNotice(denied ? S.reading.micDenied : S.reading.micMissing);
        l.source = 'manual';
      }
    }
    if (recognizes(l.source)) l.stream = new WebSpeechStream(l.source === 'ondevice');
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
    l.stream.start(onLive, (code) => {
      setNotice(
        code === 'language-not-supported'
          ? S.reading.recognizerLanguage
          : code === 'network'
            ? S.reading.recognizerNetwork
            : S.reading.recognizerFailed(code),
      );
      live.current.source = 'manual';
      setStall(null);
      setOnline(onlineStatus());
    });
    setPhase({ kind: 'card', level: card.level, step: 'listening' });
  }, [card, onFrame, onLive, student, words]);

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
      if (debug) setTracking({ syllables: l.syllables, health: l.stream?.health?.() ?? null });
      if (l.cursor >= words.length) return;
      // In Penanda guru the teacher moves the highlight, so there is no stall to prompt.
      if (l.source === 'manual') return;
      // The microphone hears the reader but the recognizer has produced nothing: say so once,
      // and don't prompt for stalls it cannot see.
      if (recognizes(l.source) && l.asrHeard === 0) {
        if (l.syllables >= SILENT_RECOGNIZER_SYLLABLES && !l.silentWarned) {
          l.silentWarned = true;
          setNotice(S.reading.recognizerSilent);
        }
        return;
      }
      // Only once the reader has started.
      if (l.cursor === 0 && !l.voiced && l.asrHeard === 0) return;
      const quiet = performance.now() - l.lastAdvance;
      if (quiet > STALL_MS && l.stalledOn !== l.cursor) {
        l.stalledOn = l.cursor;
        l.events.push({ t_ms: Math.round(performance.now() - l.t0), type: 'stalled', i: l.cursor, ms: Math.round(quiet) });
        setStall(l.cursor);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [debug, listening, words.length]);

  // The teacher corrects the highlight: Space or → moves it on, ← moves it back.
  useEffect(() => {
    if (!listening || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (live.current.source === 'simulated') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        placeAt(live.current.cursor + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        placeAt(live.current.cursor - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, listening, placeAt]);

  const supplyWord = () => {
    const l = live.current;
    if (stall === null) return;
    l.supplied.add(stall);
    l.events.push({ t_ms: Math.round(performance.now() - l.t0), type: 'supplied', i: stall });
    l.stream?.supply?.(stall);
    setStall(null);
    placeAt(Math.max(l.cursor, stall + 1));
    if (l.tokens.length) onLive(l.tokens);
  };

  const endRun = () => {
    const r = run.current;
    if (!r || phase.kind !== 'thanks') return;
    endSession(r.session.session_id);
    setPhase({ ...phase, ended: true });
  };

  /** Back to the cover with the next student who has not read yet already chosen. */
  const nextStudent = (ref: string | null) => {
    run.current = null;
    setStudentRef(ref);
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


  const thanksTake = phase.kind === 'thanks' ? app.takes[phase.takeId] : undefined;
  const readLevels = new Set<CardLevel>(
    (run.current?.session.take_ids ?? []).map((id) => app.takes[id]?.card.level).filter((l): l is CardLevel => Boolean(l)),
  );
  const reader = run.current ? nameOf(run.current.session.student_ref, app.students) : '';
  const upNext = nextToRead(app.students, app.sessions, run.current?.session.student_ref);
  const locked = listening || (phase.kind === 'card' && phase.step === 'saving');

  if (phase.kind === 'ready') {
    return (
      <section className="read" aria-label={S.nav.bacaan}>
        <Absen
          students={app.students}
          sessions={app.sessions}
          selected={studentRef}
          onSelect={(ref) => setStudentRef((cur) => (cur === ref ? null : ref))}
          startLevel={startLevel}
          onStartLevel={setStartLevel}
          source={source}
          onSource={chooseSource}
          online={online}
          onOpen={() => openCard(startLevel)}
        />
      </section>
    );
  }

  return (
    <section className="read read--stage" aria-label={S.nav.bacaan} ref={stageRef}>
      <header className="stage__bar">
        <button type="button" className="stage__back" onClick={backToCover} disabled={locked || phase.kind === 'thanks'}>
          <IconLeft size={14} />
          {S.absen.back}
        </button>
        <div className="stage__who">
          <p className="stage__name">
            {reader}
            {run.current?.session.simulated && <span className="chip chip--ink">{S.reading.simulatedChip}</span>}
          </p>
          <p className="stage__card">{level ? CARD[level] : ''}</p>
        </div>
        <div className="stage__tools">
          {level && !(phase.kind === 'thanks' && phase.ended) && (
            <Ladder size="small" value={level} read={readLevels} onChange={openCard} disabled={locked} label={S.reading.tabsLabel} />
          )}
          <TextSizeButton size={textSize} onClick={cycleTextSize} />
        </div>
      </header>

      <Book pageKey={page.key} direction={page.dir} behind={0} className="book--stage">
        {phase.kind === 'card' && card && (
          <>
            <div className="page__body">
              <Trail
                stops={card.stops ?? []}
                progress={words.length ? Math.min(shownCursor, words.length) / words.length : 0}
                block={words[Math.min(shownCursor, words.length - 1)]?.block ?? 0}
              />
              <ReadingText
                trail
                card={card}
                words={words}
                mode="tes"
                cursor={shownCursor}
                textSize={textSize}
                onWordHover={(i, el) => {
                  if (leaveTimer.current !== null) {
                    window.clearTimeout(leaveTimer.current);
                    leaveTimer.current = null;
                  }
                  if (enterTimer.current !== null) {
                    window.clearTimeout(enterTimer.current);
                    enterTimer.current = null;
                  }

                  if (i === null || el === null) {
                    leaveTimer.current = window.setTimeout(() => {
                      setKbbiTarget(null);
                      leaveTimer.current = null;
                    }, 240);
                    return;
                  }

                  const w = words[i];
                  if (!w) return;
                  const delay = kbbiTarget ? 40 : 80;
                  enterTimer.current = window.setTimeout(() => {
                    setKbbiTarget({ word: w.text, anchor: el });
                    enterTimer.current = null;
                  }, delay);
                }}
                onWordTap={(i, el) => {
                  if (listening && live.current.source !== 'simulated') {
                    placeAt(i);
                  }
                  if (leaveTimer.current !== null) {
                    window.clearTimeout(leaveTimer.current);
                    leaveTimer.current = null;
                  }
                  if (enterTimer.current !== null) {
                    window.clearTimeout(enterTimer.current);
                    enterTimer.current = null;
                  }
                  const w = words[i];
                  if (w && el) setKbbiTarget({ word: w.text, anchor: el });
                }}
              />
            </div>
            <PageFoot left={card.title} right={page.no} />
          </>
        )}
        {phase.kind === 'thanks' && card && (
          <>
            <div className="page__body thanks">
              <Trail stops={card.stops ?? []} progress={1} block={Math.max(0, (card.stops?.length ?? 1) - 1)} cheer />
              <div className="thanks__center">
                <div className="thanks__stars">
                  <SketchStars />
                </div>
                <p className="thanks__title">{S.thanks.title}</p>
                <p className="thanks__body">{S.thanks.body}</p>
              </div>
            </div>
            <PageFoot left={card.title} right={page.no} />
          </>
        )}
      </Book>

      <div className="controls" aria-label={S.reading.dock}>
        {phase.kind === 'card' && (
          <>
            {stall !== null && listening && (
              <div className="callout callout--stall" role="alert">
                <span>{S.reading.stalled(words[stall]?.text.replace(/[.,!?]/g, '') ?? '')}</span>
                <button type="button" className="btn btn--action" onClick={supplyWord}>
                  {S.reading.supplied}
                </button>
              </div>
            )}
            {notice && <p className="callout">{notice}</p>}

            <div className="controls__row">
              <p className="controls__side controls__side--left">
                {phase.step === 'listening' ? (
                  <span className="controls__timer">
                    <span className="controls__dot" aria-hidden="true" />
                    {formatClock(elapsed)}
                  </span>
                ) : phase.step === 'armed' ? (
                  live.current.source === 'manual' ? S.engine.manual : S.absen.armedHint(reader)
                ) : null}
              </p>
              {phase.step === 'saving' ? (
                <p className="controls__saving">{S.reading.scoring}</p>
              ) : (
                <ListenButton
                  listening={listening}
                  level={() => live.current.stream?.level?.() ?? live.current.capture?.level() ?? 0}
                  label={listening ? S.reading.stop : S.reading.start}
                  icon={listening ? <IconStop size={22} /> : <IconMic size={26} />}
                  onClick={() => void (listening ? finish() : startListening())}
                />
              )}
              <p className="controls__side controls__side--right">
                {listening
                  ? live.current.source === 'manual'
                    ? S.reading.marking
                    : recognizes(live.current.source)
                      ? S.reading.tapToFix
                      : S.engine.simulated
                  : null}
              </p>
            </div>

            {debug && phase.step !== 'armed' && (
              <details className="transcript" open={route.params.get('debug') === '1'}>
                <summary className="transcript__label">{S.reading.transcript}</summary>
                {tracking && (
                  <p className="transcript__label">
                    {live.current.detector ? S.reading.voiceLine(tracking.syllables, totalSyllables) : S.reading.noVoice}{' '}
                    {tracking.health ? S.reading.recognizerLine(tracking.health) : null}
                  </p>
                )}
                {transcript.length > 0 && (
                  <p className="transcript__text">
                    {transcript.map((seg, k) => (
                      <span key={k} className={seg.final ? undefined : 'is-interim'}>
                        {seg.text}{' '}
                      </span>
                    ))}
                  </p>
                )}
                <p className="transcript__label">{S.reading.transcriptPosition(cursor, words.length)}</p>
              </details>
            )}
          </>
        )}

        {phase.kind === 'thanks' && thanksTake && (
          <NextCard
            take={thanksTake}
            ended={phase.ended}
            reader={reader}
            upNext={upNext}
            onOpen={openCard}
            onEnd={endRun}
            onNextStudent={() => nextStudent(upNext?.student_ref ?? null)}
          />
        )}
      </div>

      <WordModal
        word={kbbiTarget?.word ?? null}
        anchor={kbbiTarget?.anchor ?? null}
        open={Boolean(kbbiTarget)}
        onClose={() => {
          if (enterTimer.current !== null) {
            window.clearTimeout(enterTimer.current);
            enterTimer.current = null;
          }
          if (leaveTimer.current !== null) {
            window.clearTimeout(leaveTimer.current);
            leaveTimer.current = null;
          }
          setKbbiTarget(null);
        }}
        onMouseEnter={() => {
          if (leaveTimer.current !== null) {
            window.clearTimeout(leaveTimer.current);
            leaveTimer.current = null;
          }
        }}
        onMouseLeave={() => {
          if (leaveTimer.current !== null) {
            window.clearTimeout(leaveTimer.current);
          }
          leaveTimer.current = window.setTimeout(() => {
            setKbbiTarget(null);
            leaveTimer.current = null;
          }, 240);
        }}
      />
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

const today = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

interface AbsenProps {
  students: Student[];
  sessions: Session[];
  selected: string | null;
  onSelect: (ref: string) => void;
  startLevel: CardLevel;
  onStartLevel: (level: CardLevel) => void;
  source: Source;
  onSource: (s: Source) => void;
  online: OnlineStatus;
  onOpen: () => void;
}

/** Absen: the class roll call. Tap a name, choose the first step of the ladder, start. */
function Absen({ students, sessions, selected, onSelect, startLevel, onStartLevel, source, onSource, online, onOpen }: AbsenProps) {
  const sources: Source[] = ['online', 'manual', 'simulated'];
  const engineNote =
    source === 'online' ? S.engine.online[online] : source === 'manual' ? S.engine.manual : S.engine.simulated;
  const blocked = source === 'online' && online !== 'available';
  return (
    <div className="absen">
      <header className="absen__head">
        <div>
          <p className="absen__date">{today.format(new Date())}</p>
          <h1 className="absen__title">{S.absen.title}</h1>
        </div>
        <div className="absen__engine">
          <div className="seg seg--pill" role="radiogroup" aria-label={S.engine.label}>
            {sources.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                className="seg__opt"
                disabled={s === 'online' && online === 'unsupported'}
                onClick={() => onSource(s)}
              >
                {SOURCE[s]}
              </button>
            ))}
          </div>
          <p className="absen__note">{engineNote}</p>
        </div>
      </header>

      {students.length ? (
        <ol className="roll">
          {students.map((s, k) => {
            const stage = stageOf(s, sessions);
            const open = selected === s.student_ref;
            return (
              <li key={s.student_ref} className="roll__item" data-open={open ? '' : undefined}>
                <button type="button" className="roll__row" aria-expanded={open} onClick={() => onSelect(s.student_ref)}>
                  <span className="roll__no">{String(k + 1).padStart(2, '0')}</span>
                  <span className="roll__name">{s.name ?? s.student_ref}</span>
                  <span className="roll__code">{s.student_ref}</span>
                  <span className="roll__stage" data-stage={stage.kind}>
                    {stage.kind === 'new'
                      ? S.ready.stage.new
                      : stage.kind === 'pending'
                        ? S.ready.stage.pending
                        : S.ready.stage.placed(LEVEL[stage.level])}
                  </span>
                </button>
                {open && (
                  <div className="roll__open">
                    {!s.consents.assessment && source !== 'simulated' && (
                      <p className="callout">{S.ready.noConsent(s.name ?? s.student_ref)}</p>
                    )}
                    <div className="roll__start">
                      <div className="roll__ladder">
                        <p className="roll__label">{S.ready.startLine}</p>
                        <Ladder value={startLevel} onChange={onStartLevel} label={S.ready.tabsLabel} />
                      </div>
                      <button type="button" className="btn btn--cta" onClick={onOpen} disabled={blocked}>
                        <IconMic />
                        {S.absen.open(CARD[startLevel])}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="absen__empty">
          {S.ready.noStudents}{' '}
          <a href="#/kelas">{S.ready.toKelas}</a>
        </p>
      )}
    </div>
  );
}

interface NextCardProps {
  take: Take;
  ended: boolean;
  reader: string;
  upNext: Student | null;
  onOpen: (level: CardLevel) => void;
  onEnd: () => void;
  onNextStudent: () => void;
}

/** Kartu berikutnya: the teacher's choice after each card. Provisional, from the engine alone. */
function NextCard({ take, ended, reader, upNext, onOpen, onEnd, onNextStudent }: NextCardProps) {
  if (ended) {
    return (
      <div className="panel">
        <p className="panel__lead">
          <span className="panel__check" aria-hidden="true">
            <IconCheck size={14} />
          </span>
          {S.done.pending(reader)}
        </p>
        {!upNext && <p className="panel__hint">{S.done.allRead}</p>}
        <div className="panel__actions">
          <button type="button" className="btn btn--ghost btn--tall" onClick={() => navigate('tinjau', take.session_id)}>
            {S.done.review}
          </button>
          <button type="button" className="btn btn--cta" onClick={onNextStudent}>
            {upNext ? S.done.nextStudentRef(upNext.name ?? upNext.student_ref) : S.done.nextStudent}
          </button>
        </div>
      </div>
    );
  }

  const outcome = take.source === 'manual' ? null : cardOutcome(take, false);
  const suggested = outcome ? nextCard(take.card.level, outcome.passed) : null;
  const quality = take.quality;
  const lowSpeech = quality.status === 'retry_suggested' && (quality.speech_ratio ?? 1) < 0.15;

  return (
    <div className="panel">
      {quality.status === 'retry_suggested' && (
        <p className="callout">{lowSpeech ? S.next.quality(Math.round((quality.speech_ratio ?? 0) * 100)) : S.next.clipping}</p>
      )}
      {outcome ? (
        <p className="panel__lead">
          <span className="panel__label">{S.next.suggestion}</span>
          {suggested ? CARD[suggested] : S.next.stopHere}
        </p>
      ) : (
        <p className="panel__hint">{S.next.pickTab}</p>
      )}
      <div className="panel__actions">
        <button type="button" className="btn btn--ghost btn--tall" onClick={() => onOpen(take.card.level)}>
          {S.next.retry}
        </button>
        {suggested ? (
          <button type="button" className="btn btn--cta" onClick={() => onOpen(suggested)}>
            {S.next.continueTo(CARD[suggested])}
          </button>
        ) : (
          <button type="button" className="btn btn--cta" onClick={onEnd}>
            {S.next.finish(reader)}
          </button>
        )}
      </div>
      <div className="panel__foot">
        {outcome ? (
          <details className="panel__why">
            <summary>{S.next.why}</summary>
            <p>{S.next.whyEngine(outcome.correct, outcome.total, outcome.needed, outcome.rule)}</p>
          </details>
        ) : (
          <span />
        )}
        {suggested && (
          <button type="button" className="btn btn--text" onClick={onEnd}>
            {S.next.finish(reader)}
          </button>
        )}
      </div>
    </div>
  );
}
