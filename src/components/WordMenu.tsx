import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { effectiveStatus, isError } from '../lib/rubric';
import { CONFIDENCE, S, STATUS, STATUS_HINT } from '../strings';
import type { Take, WordStatus } from '../types';
import { IconPlay } from './Icons';
import './WordMenu.css';

const CHOICES: WordStatus[] = ['correct', 'substituted', 'omitted', 'supplied', 'repeated', 'self_corrected'];

interface WordMenuProps {
  take: Take;
  i: number;
  /** The scrolling page body the menu is positioned in. */
  container: HTMLElement;
  onSet: (status: WordStatus | null) => void;
  onPlay?: () => void;
  onClose: () => void;
}

/** Status picker for one word. The engine's answer stays visible beside the teacher's choice. */
export function WordMenu({ take, i, container, onSet, onPlay, onClose }: WordMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const word = take.words[i];
  const current = effectiveStatus(take, i);
  const edited = take.teacher.edits[i] !== undefined;

  useLayoutEffect(() => {
    const menu = ref.current;
    const anchor = container.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!menu || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const base = container.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.min(Math.max(a.left - base.left + a.width / 2 - width / 2, 8), container.clientWidth - width - 8);
    let top = a.bottom - base.top + container.scrollTop + 10;
    if (top + height > container.scrollHeight && a.top - base.top + container.scrollTop - height - 10 > 0) {
      top = a.top - base.top + container.scrollTop - height - 10;
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.setProperty('--arrow', `${a.left - base.left + a.width / 2 - left}px`);
  }, [container, i, take]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"], [role="radio"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        container.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest(`[data-i="${i}"]`)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
    // Runs once per opened word, so focus is not stolen on every edit.
  }, [i]);

  return (
    <div
      ref={ref}
      className="word-menu"
      role="dialog"
      aria-label={word.expected}
      data-no-snapshot=""
      style={{ '--arrow': '50%' } as CSSProperties}
    >
      <p className="word-menu__word">{word.expected}</p>
      <dl className="word-menu__facts">
        {take.source !== 'manual' && (
          <div>
            <dt>{S.review.heard}</dt>
            <dd>{word.heard ? `“${word.heard}”` : S.review.nothingHeard}</dd>
          </div>
        )}
        {word.confidence && (
          <div>
            <dt>{S.review.confidence}</dt>
            <dd>{CONFIDENCE[word.confidence]}</dd>
          </div>
        )}
        {edited && (
          <div>
            <dt>{S.review.engineSaid}</dt>
            <dd>{STATUS[word.status]}</dd>
          </div>
        )}
      </dl>
      <div className="word-menu__opts" role="radiogroup" aria-label={word.expected}>
        {CHOICES.map((status) => (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={current === status}
            className="seg__opt"
            data-error={isError(status) ? '' : undefined}
            onClick={() => onSet(status)}
          >
            {STATUS[status]}
          </button>
        ))}
      </div>
      <p className="word-menu__hint">{STATUS_HINT[current]}</p>
      {(onPlay || edited) && (
        <div className="word-menu__actions">
          {onPlay && (
            <button type="button" className="btn btn--ghost" onClick={onPlay}>
              <IconPlay size={12} />
              {S.review.play}
            </button>
          )}
          {edited && (
            <button type="button" className="btn btn--text" onClick={() => onSet(null)}>
              {S.review.resetEdit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
