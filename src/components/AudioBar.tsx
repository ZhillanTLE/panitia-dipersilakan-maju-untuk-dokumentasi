import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react';
import { S } from '../strings';
import { IconPause, IconPlay } from './Icons';
import './AudioBar.css';

export interface AudioBarHandle {
  playFrom(ms: number, untilMs?: number): void;
}

interface AudioBarProps {
  /** The recording. Without one, the bar replays the word timings silently. */
  blob: Blob | null;
  timelineMs: number;
  markers: { ms: number; label: string }[];
  onTime: (ms: number | null) => void;
  note?: string;
  ref?: Ref<AudioBarHandle>;
}

/** One clock for both a real recording and a silent replay of word timings. */
class Player {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private from = 0;
  private startedAt = 0;
  private running = false;
  private until: number | null = null;
  private frame = 0;
  duration: number;

  constructor(
    blob: Blob | null,
    timelineMs: number,
    private readonly onTick: (ms: number, playing: boolean) => void,
    onDuration: (ms: number) => void,
  ) {
    this.duration = timelineMs;
    if (blob) {
      this.url = URL.createObjectURL(blob);
      this.audio = new Audio(this.url);
      this.audio.preload = 'metadata';
      this.audio.addEventListener('loadedmetadata', () => {
        if (this.audio && Number.isFinite(this.audio.duration)) {
          this.duration = this.audio.duration * 1000;
          onDuration(this.duration);
        }
      });
    }
    onDuration(this.duration);
  }

  position(): number {
    if (this.audio) return this.audio.currentTime * 1000;
    return this.running ? this.from + performance.now() - this.startedAt : this.from;
  }

  play(from?: number, until?: number): void {
    if (from !== undefined) this.seek(from);
    if (this.position() >= this.duration - 50) this.seek(0);
    this.until = until ?? null;
    if (this.audio) void this.audio.play().catch(() => this.pause());
    else {
      this.startedAt = performance.now();
      this.running = true;
    }
    cancelAnimationFrame(this.frame);
    const tick = () => {
      const t = Math.min(this.position(), this.duration);
      const end = t >= this.duration - 1 || (this.until !== null && t >= this.until);
      if (end) {
        this.pause();
        return;
      }
      this.onTick(t, true);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  pause(): void {
    cancelAnimationFrame(this.frame);
    if (this.audio) this.audio.pause();
    else {
      this.from = this.position();
      this.running = false;
    }
    this.until = null;
    this.onTick(Math.min(this.position(), this.duration), false);
  }

  seek(ms: number): void {
    const t = Math.max(0, Math.min(ms, this.duration));
    if (this.audio) this.audio.currentTime = t / 1000;
    else {
      this.from = t;
      this.startedAt = performance.now();
    }
    this.onTick(t, this.isPlaying());
  }

  isPlaying(): boolean {
    return this.audio ? !this.audio.paused : this.running;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.audio?.pause();
    if (this.url) URL.revokeObjectURL(this.url);
  }
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function AudioBar({ blob, timelineMs, markers, onTime, note, ref }: AudioBarProps) {
  const player = useRef<Player | null>(null);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(timelineMs);

  useEffect(() => {
    const p = new Player(
      blob,
      timelineMs,
      (ms, isPlaying) => {
        setPos(ms);
        setPlaying(isPlaying);
        onTimeRef.current(isPlaying || ms > 0 ? ms : null);
      },
      setDuration,
    );
    player.current = p;
    setPos(0);
    setPlaying(false);
    onTimeRef.current(null);
    return () => p.destroy();
  }, [blob, timelineMs]);

  useImperativeHandle(ref, () => ({
    playFrom(ms, untilMs) {
      player.current?.play(Math.max(0, ms), untilMs);
    },
  }));

  const toggle = () => {
    const p = player.current;
    if (!p) return;
    if (p.isPlaying()) p.pause();
    else p.play();
  };

  const disabled = duration <= 0;

  return (
    <div className="audio">
      <button
        type="button"
        className={`btn btn--round${playing ? ' is-on' : ''}`}
        onClick={toggle}
        disabled={disabled}
        aria-label={playing ? S.audio.pause : S.audio.play}
      >
        {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
      </button>
      <div className="audio__track" style={{ '--p': duration ? pos / duration : 0 } as CSSProperties}>
        <input
          type="range"
          className="audio__range"
          min={0}
          max={Math.max(1, Math.round(duration))}
          step={10}
          value={Math.round(pos)}
          disabled={disabled}
          aria-label={S.audio.seek}
          aria-valuetext={`${clock(pos)} / ${clock(duration)}`}
          onChange={(e) => player.current?.seek(Number(e.target.value))}
        />
        {duration > 0 &&
          markers.map((m, k) => (
            <button
              key={k}
              type="button"
              className="audio__mark"
              style={{ left: `${(Math.min(m.ms, duration) / duration) * 100}%` }}
              title={m.label}
              aria-label={m.label}
              onClick={() => player.current?.play(Math.max(0, m.ms - 400), m.ms + 1800)}
            />
          ))}
      </div>
      <span className="audio__time">
        {clock(pos)} / {clock(duration)}
      </span>
      {note && <p className="audio__note">{note}</p>}
    </div>
  );
}
