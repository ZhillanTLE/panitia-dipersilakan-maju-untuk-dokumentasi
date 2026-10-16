import { LEVEL } from '../strings';
import type { CardLevel } from '../types';
import './Ladder.css';

/** Card levels from the bottom step up: the reading ladder ("tangga baca"). */
export const LADDER: CardLevel[] = ['huruf', 'suku_kata', 'kata', 'kalimat', 'paragraf'];

interface LadderProps {
  value: CardLevel;
  /** Steps already read in this session; marked as read, never right or wrong. */
  read?: ReadonlySet<CardLevel>;
  onChange?: (level: CardLevel) => void;
  disabled?: boolean;
  size?: 'large' | 'small';
  label: string;
}

/** A staircase of card levels. Large to choose where to start; small to show and switch the open card. */
export function Ladder({ value, read, onChange, disabled, size = 'large', label }: LadderProps) {
  return (
    <div className={`ladder ladder--${size}`} role="radiogroup" aria-label={label}>
      {LADDER.map((level, k) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          className="ladder__step"
          data-read={read?.has(level) && value !== level ? '' : undefined}
          style={{ '--k': k } as React.CSSProperties}
          disabled={disabled || !onChange}
          title={LEVEL[level]}
          onClick={() => onChange?.(level)}
        >
          <span className="ladder__label">{LEVEL[level]}</span>
        </button>
      ))}
    </div>
  );
}
