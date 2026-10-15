import type { HeardToken } from './scoring';

// On-device speech recognition through the Web Speech API. CLAUDE.md rule 7 forbids
// cloud calls, so a browser that cannot promise local processing is treated as having
// no recognizer at all. The teacher then marks the reading by hand.

export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

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
}

export class OnDeviceStream implements HeardStream {
  private recognition: Recognition | null = null;
  private committed: string[] = [];
  private current: string[] = [];
  private firstHeard: number[] = [];
  private active = false;
  private t0 = 0;
  private onEnded: (() => void) | null = null;

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
    if (SR.available) rec.processLocally = true;
    else rec.mode = 'ondevice-only';

    rec.onresult = (event) => {
      const words: string[] = [];
      for (let k = 0; k < event.results.length; k++) {
        words.push(...event.results[k][0].transcript.trim().split(/\s+/).filter(Boolean));
      }
      this.current = words;
      onLive(this.tokens());
    };
    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.active = false;
      onError(event.error);
    };
    // Recognition ends on long silences; keep listening until the teacher stops the take.
    rec.onend = () => {
      this.committed.push(...this.current);
      this.current = [];
      if (this.active) this.listen(onLive, onError);
      else this.onEnded?.();
    };
    rec.start();
    this.recognition = rec;
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
