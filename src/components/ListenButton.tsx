import { useEffect, useRef, type ReactNode } from 'react';
import './ListenButton.css';

interface ListenButtonProps {
  listening: boolean;
  /** 0..1 loudness, polled every frame while listening. */
  level: () => number;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

/** The one round action on the reading screen. While listening, its ring breathes with the reader's voice. */
export function ListenButton({ listening, level, label, icon, onClick, disabled }: ListenButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!listening || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--lvl', '0');
      return;
    }
    let frame = 0;
    let smooth = 0;
    const tick = () => {
      smooth = smooth * 0.8 + Math.min(1, levelRef.current() * 1.6) * 0.2;
      el.style.setProperty('--lvl', smooth.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [listening]);

  return (
    <button
      ref={ref}
      type="button"
      className={`listen${listening ? ' is-listening' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="listen__ring" aria-hidden="true" />
      <span className="listen__core" aria-hidden="true">
        {icon}
      </span>
      <span className="listen__label">{label}</span>
    </button>
  );
}
