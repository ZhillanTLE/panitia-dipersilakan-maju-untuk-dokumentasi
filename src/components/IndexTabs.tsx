import { CARD_ORDER } from '../lib/rubric';
import { LEVEL } from '../strings';
import type { CardLevel } from '../types';
import './IndexTabs.css';

interface IndexTabsProps {
  /** The card that is open, or the card the reading will start from. */
  current: CardLevel;
  /** Cards already read in this session. They are only marked as read, never right or wrong. */
  read?: ReadonlySet<CardLevel>;
  /** `pick` chooses the first card; `go` opens another card; `locked` while the child reads. */
  mode: 'pick' | 'go' | 'locked';
  label: string;
  onChoose?: (level: CardLevel) => void;
}

/**
 * Thumb-index tabs on the book's fore-edge, one per card, in the order the reading
 * steps down through them. On phones they sit along the top edge.
 */
export function IndexTabs({ current, read, mode, label, onChoose }: IndexTabsProps) {
  const picking = mode === 'pick';
  return (
    <div className={`tabs tabs--${mode}`} role={picking ? 'radiogroup' : 'group'} aria-label={label}>
      {CARD_ORDER.map((level) => {
        const isCurrent = level === current;
        const isRead = !isCurrent && Boolean(read?.has(level));
        return (
          <button
            key={level}
            type="button"
            className="tab"
            data-current={isCurrent ? '' : undefined}
            data-read={isRead ? '' : undefined}
            role={picking ? 'radio' : undefined}
            aria-checked={picking ? isCurrent : undefined}
            aria-current={!picking && isCurrent ? 'step' : undefined}
            disabled={mode === 'locked' && !isCurrent}
            tabIndex={mode === 'locked' ? -1 : undefined}
            onClick={() => mode !== 'locked' && !isCurrent && onChoose?.(level)}
          >
            <span className="tab__label">{LEVEL[level]}</span>
            {isRead && <span className="tab__dot" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
