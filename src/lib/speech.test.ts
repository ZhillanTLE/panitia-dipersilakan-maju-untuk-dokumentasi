import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSpeechStream } from './speech';

// A stand-in for Chrome's recognizer: each test drives the sessions by hand.
class FakeRecognition {
  static sessions: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: { results: unknown }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  ended = false;
  start() {
    FakeRecognition.sessions.push(this);
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }
  say(text: string) {
    const result = Object.assign([{ transcript: text }], { isFinal: true });
    this.onresult?.({ results: Object.assign([result], { length: 1 }) });
  }
  drop() {
    this.onerror?.({ error: 'network' });
    this.end();
  }
  end() {
    if (this.ended) return;
    this.ended = true;
    this.onend?.();
  }
}

const latest = () => FakeRecognition.sessions[FakeRecognition.sessions.length - 1];

describe('WebSpeechStream on a shaky connection', () => {
  let online = true;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.sessions = [];
    online = true;
    vi.stubGlobal('window', { SpeechRecognition: FakeRecognition, setTimeout, clearTimeout });
    vi.stubGlobal('navigator', {
      get onLine() {
        return online;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts a new session after a dropped link and keeps the words heard', async () => {
    const stream = new WebSpeechStream(false);
    const onError = vi.fn();
    stream.start(() => {}, onError);
    latest().say('di sebuah');
    latest().drop();
    expect(FakeRecognition.sessions).toHaveLength(2);
    vi.advanceTimersByTime(300);
    expect(FakeRecognition.sessions).toHaveLength(3);
    latest().say('bintang');
    expect(onError).not.toHaveBeenCalled();
    const words = await stream.stop();
    expect(words.map((w) => w.text)).toEqual(['di', 'sebuah', 'bintang']);
  });

  it('gives up when the link keeps dropping with no words between', () => {
    const stream = new WebSpeechStream(false);
    const onError = vi.fn();
    stream.start(() => {}, onError);
    for (let k = 0; k < 4; k++) {
      latest().drop();
      vi.advanceTimersByTime(3000);
    }
    expect(onError).not.toHaveBeenCalled();
    latest().drop();
    expect(onError).toHaveBeenCalledWith('network');
  });

  it('gives up at once when the device is offline', () => {
    const stream = new WebSpeechStream(false);
    const onError = vi.fn();
    stream.start(() => {}, onError);
    online = false;
    latest().drop();
    expect(onError).toHaveBeenCalledWith('network');
  });

  it('stops cleanly while waiting to retry', async () => {
    const stream = new WebSpeechStream(false);
    stream.start(() => {}, () => {});
    latest().say('di');
    latest().drop();
    const words = await stream.stop();
    vi.advanceTimersByTime(5000);
    expect(words.map((w) => w.text)).toEqual(['di']);
    expect(FakeRecognition.sessions).toHaveLength(2);
  });
});
