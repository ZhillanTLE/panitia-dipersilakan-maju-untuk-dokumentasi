import type { HeardToken } from './scoring';

// Speech recognition through the Web Speech API, online or on the device.
// The online recognizer is the web MVP's path: Chrome sends the audio to Google while the
// child reads. It breaks CLAUDE.md rule 7 (offline only), so the teacher chooses it, the
// desk says so, and every take records it in `source` and `versions.model`. The on-device
// path stays for when browsers can keep Bahasa Indonesia local.

export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';
export type OnlineStatus = 'available' | 'offline' | 'unsupported';

const LANG = 'id-ID';

interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
}

interface RecognitionEvent {
  results: { length: number; [index: number]: RecognitionResult };
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  mode?: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface AvailabilityOptions {
  langs: string[];
  processLocally: boolean;
}

interface RecognitionConstructor {
  new (): Recognition;
  available?(options: AvailabilityOptions): Promise<OnDeviceStatus>;
  install?(options: AvailabilityOptions): Promise<boolean>;
  // Earlier shape of the same proposal, still shipped by some Chromium builds.
  availableOnDevice?(lang: string): Promise<OnDeviceStatus>;
  installOnDevice?(lang: string): Promise<boolean>;
}

function recognitionClass(): RecognitionConstructor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function onlineStatus(): OnlineStatus {
  if (!recognitionClass()) return 'unsupported';
  return navigator.onLine ? 'available' : 'offline';
}

export async function onDeviceStatus(): Promise<OnDeviceStatus> {
  const SR = recognitionClass();
  if (!SR) return 'unsupported';
  try {
    if (SR.available) return await SR.available({ langs: [LANG], processLocally: true });
    if (SR.availableOnDevice) return await SR.availableOnDevice(LANG);
  } catch {
    return 'unsupported';
  }
  // The browser has speech recognition but no way to keep it on the device.
  return 'unsupported';
}

/** Asks the browser to download its Indonesian speech pack. Needs a teacher action. */
export async function installOnDevice(): Promise<boolean> {
  const SR = recognitionClass();
  try {
    if (SR?.install) return await SR.install({ langs: [LANG], processLocally: true });
    if (SR?.installOnDevice) return await SR.installOnDevice(LANG);
  } catch {
    return false;
  }
  return false;
}

/** A source of heard words during one take. */
export interface HeardStream {
  start(onLive: (tokens: HeardToken[]) => void, onError: (code: string) => void): void;
  /** Stops listening and resolves with the final words (the slow-path input). */
  stop(): Promise<HeardToken[]>;
  cancel(): void;
  /** The teacher read word `i` aloud for the child. */
  supply?(i: number): void;
  /** 0..1 loudness for streams that have no microphone. */
  level?(): number;
  /** Resolves when a scripted stream has nothing left to say. */
  finished?: Promise<void>;
  /** The recognizer's raw output, for the developer readout. */
  segments?(): TranscriptSegment[];
  health?(): RecognizerHealth;
}

export interface TranscriptSegment {
  text: string;
  final: boolean;
}

/** Recognizer lifecycle counts, for the developer readout. */
export interface RecognizerHealth {
  starts: number;
  results: number;
  error: string | null;
}

/** Errors that will not clear by starting again. */
const FATAL = new Set(['language-not-supported', 'not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'bad-grammar']);
/** A session that ends this fast with nothing heard counts as a failed start. */
const QUICK_END_MS = 1000;
const MAX_QUICK_ENDS = 3;
/**
 * Online only: a session whose guesses stop changing for this long is ended, so its words
 * are kept and a fresh session listens on. Chrome can leave a phrase interim indefinitely.
 */
const IDLE_COMMIT_MS = 1500;

export class WebSpeechStream implements HeardStream {
  /** `local` keeps recognition on the device; otherwise the browser's online service hears the audio. */
  constructor(private readonly local: boolean) {}

  private recognition: Recognition | null = null;
  private committed: string[] = [];
  private current: string[] = [];
  private committedSegments: TranscriptSegment[] = [];
  private currentSegments: TranscriptSegment[] = [];
  private firstHeard: number[] = [];
  private active = false;
  private t0 = 0;
  private onEnded: (() => void) | null = null;
  private stats: RecognizerHealth = { starts: 0, results: 0, error: null };
  private quickEnds = 0;
  private failed = false;

  health(): RecognizerHealth {
    return { ...this.stats };
  }

  start(onLive: (tokens: HeardToken[]) => void, onError: (code: string) => void): void {
    this.t0 = performance.now();
    this.active = true;
    this.listen(onLive, onError);
  }

  private listen(onLive: (tokens: HeardToken[]) => void, onError: (code: string) => void): void {
    const SR = recognitionClass();
    if (!SR) {
      onError('unsupported');
      return;
    }
    const rec = new SR();
    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    if (this.local) {
      if (SR.available) rec.processLocally = true;
      else rec.mode = 'ondevice-only';
    }

    const startedAt = performance.now();
    let heardThisRun = false;
    let idle = 0;
    const endSession = () => {
      try {
        rec.stop();
      } catch {
        // Already stopping.
      }
    };

    rec.onresult = (event) => {
      // A stopping session can send a last, empty result; it must not wipe the words heard.
      if (!event.results.length) return;
      heardThisRun = true;
      this.stats.results++;
      const words: string[] = [];
      const segments: TranscriptSegment[] = [];
      for (let k = 0; k < event.results.length; k++) {
        const text = event.results[k][0].transcript.trim();
        segments.push({ text, final: event.results[k].isFinal });
        words.push(...text.split(/\s+/).filter(Boolean));
      }
      this.current = words;
      this.currentSegments = segments;
      if (import.meta.env.DEV) console.debug('[speech]', segments.map((s) => `${s.final ? '■' : '□'} ${s.text}`).join(' | '));
      onLive(this.tokens());
      // Chrome's online recognizer stops returning words after its first final phrase, and can
      // leave a phrase interim for many seconds. End the session once everything is final, or
      // once the guesses stop changing; `onend` keeps the words and starts a fresh session, so
      // listening carries on through the whole card.
      if (!this.local && this.active) {
        window.clearTimeout(idle);
        if (segments.every((seg) => seg.final)) endSession();
        else idle = window.setTimeout(() => this.active && endSession(), IDLE_COMMIT_MS);
      }
    };
    const fail = (code: string) => {
      if (this.failed) return;
      this.failed = true;
      this.active = false;
      onError(code);
    };
    rec.onerror = (event) => {
      this.stats.error = event.error;
      if (import.meta.env.DEV) console.debug('[speech] error', event.error);
      if (FATAL.has(event.error)) fail(event.error);
    };
    // Recognition ends on long silences; keep listening until the teacher stops the take,
    // but give up when it keeps ending the moment it starts.
    rec.onend = () => {
      window.clearTimeout(idle);
      this.committed.push(...this.current);
      this.current = [];
      this.committedSegments.push(...this.currentSegments);
      this.currentSegments = [];
      if (!this.active) {
        this.onEnded?.();
        return;
      }
      const quick = !heardThisRun && performance.now() - startedAt < QUICK_END_MS;
      this.quickEnds = quick ? this.quickEnds + 1 : 0;
      if (this.quickEnds >= MAX_QUICK_ENDS) fail(this.stats.error ?? 'aborted');
      else this.listen(onLive, onError);
    };
    this.stats.starts++;
    try {
      rec.start();
    } catch {
      fail('start-failed');
      return;
    }
    this.recognition = rec;
  }

  segments(): TranscriptSegment[] {
    return [...this.committedSegments, ...this.currentSegments];
  }

  private tokens(): HeardToken[] {
    const words = [...this.committed, ...this.current];
    const now = Math.round(performance.now() - this.t0);
    for (let k = 0; k < words.length; k++) this.firstHeard[k] ??= now;
    return words.map((text, k) => ({ text, t_ms: this.firstHeard[k] }));
  }

  stop(): Promise<HeardToken[]> {
    this.active = false;
    return new Promise((resolve) => {
      const done = () => resolve(this.tokens());
      this.onEnded = done;
      this.recognition?.stop();
      setTimeout(done, 1500);
    });
  }

  cancel(): void {
    this.active = false;
    this.recognition?.abort();
  }
}

/** No recognizer: the teacher moves the highlight and marks the reading in Tinjau. */
export class ManualStream implements HeardStream {
  start(): void {}
  stop(): Promise<HeardToken[]> {
    return Promise.resolve([]);
  }
  cancel(): void {}
}
