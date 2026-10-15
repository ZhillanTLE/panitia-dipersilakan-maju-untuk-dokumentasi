import { Fragment, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { TextSize } from '../lib/prefs';
import { STATUS } from '../strings';
import type { Card, CardWord, Insertion, WordStatus } from '../types';
import './ReadingText.css';

export interface ReviewMarks {
  status(i: number): WordStatus;
  edited(i: number): boolean;
  insertions: Insertion[];
  selected?: number;
}

interface ReadingTextProps {
  card: Card;
  words: CardWord[];
  mode: 'tes' | 'review';
  /** tes: index of the word being read. Words before it are read. */
  cursor?: number;
  /** tes: 0..1 of the current word's syllables already voiced; omit for a full underline. */
  progress?: number;
  /** review: word to box during playback. */
  playing?: number;
  review?: ReviewMarks;
  onWordTap?: (i: number) => void;
  textSize: TextSize;
}

const SIZES: CSSProperties[] = [
  { '--rs': 'var(--fs-5)' } as CSSProperties,
  { '--rs': 'var(--fs-4)' } as CSSProperties,
  { '--rs': 'var(--fs-3)' } as CSSProperties,
];

/**
 * Card text with the reading highlight. In `tes` the highlight never shows right or
 * wrong (CLAUDE.md rule 5): read words are only dimmed.
 */
export function ReadingText({ card, words, mode, cursor = 0, progress, playing, review, onWordTap, textSize }: ReadingTextProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const target = mode === 'tes' ? (cursor < words.length ? cursor : -1) : (playing ?? -1);
  const focusSentence = words[Math.min(cursor, words.length - 1)]?.sentence ?? 0;

  useLayoutEffect(() => {
    const root = rootRef.current;
    const box = boxRef.current;
    if (!root || !box) return;
    const place = () => {
      const el = target >= 0 ? root.querySelector<HTMLElement>(`[data-i="${target}"]`) : null;
      if (!el) {
        box.dataset.shown = '';
        return;
      }
      const r = el.getBoundingClientRect();
      const base = root.getBoundingClientRect();
      const first = box.dataset.shown !== '1';
      if (first) box.style.transition = 'none';
      box.style.transform = `translate(${r.left - base.left - 4}px, ${r.top - base.top - 2}px)`;
      box.style.width = `${r.width + 8}px`;
      box.style.height = `${r.height + 4}px`;
      box.dataset.shown = '1';
      if (first) {
        void box.offsetWidth;
        box.style.transition = '';
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [target, words, textSize, card.id, mode]);

  const renderWord = (w: CardWord): ReactNode => {
    let state: string;
    if (mode === 'tes') {
      state = w.i < cursor ? 'read' : w.sentence > focusSentence ? 'later' : 'upcoming';
      if (w.i === cursor) state = 'current';
    } else {
      state = review?.status(w.i) ?? 'correct';
    }
    const syllables = mode === 'tes' && w.i === cursor ? card.syllables?.[w.norm] : undefined;
    const content = syllables
      ? syllables.split('-').map((s, k) => (
          <Fragment key={k}>
            {k > 0 && <span className="syl-gap" aria-hidden="true" />}
            <span className="syl">{s}</span>
          </Fragment>
        ))
      : w.text;
    const common = {
      'data-i': w.i,
      'data-state': state,
      'data-edited': review?.edited(w.i) ? '' : undefined,
      className: 'w',
    };
    if (!onWordTap) return <span {...common}>{content}</span>;
    const label = mode === 'review' ? `${w.text}: ${STATUS[state as WordStatus]}` : undefined;
    return (
      <button
        type="button"
        {...common}
        aria-label={label}
        aria-pressed={mode === 'review' ? review?.selected === w.i : undefined}
        onClick={() => onWordTap(w.i)}
      >
        {content}
      </button>
    );
  };

  const insertionsAfter = (i: number) =>
    review?.insertions
      .filter((ins) => ins.after_i === i)
      .map((ins, k) => (
        <span key={`ins-${i}-${k}`} className="ins" title={`Sisipan: ${ins.heard}`}>
          +{ins.heard}
        </span>
      ));

  const blocks = card.blocks.map((_, b) => words.filter((w) => w.block === b));

  return (
    <div
      ref={rootRef}
      className={`reading reading--${card.layout} reading--${mode}${card.level === 'huruf' || card.level === 'suku_kata' ? ' reading--glyphs' : ''}`}
      style={SIZES[textSize]}
    >
      <span
        ref={boxRef}
        className="reading__box"
        style={{ '--p': mode === 'tes' && progress !== undefined ? progress : 1 } as CSSProperties}
        aria-hidden="true"
      />
      {insertionsAfter(-1)}
      {card.layout === 'grid' ? (
        <div className="reading__grid">
          {words.map((w) => (
            <span key={w.i} className="reading__cell">
              {renderWord(w)}
              {insertionsAfter(w.i)}
            </span>
          ))}
        </div>
      ) : (
        blocks.map((blockWords, b) => (
          <p key={b} className="reading__block">
            {blockWords.map((w, k) => (
              <Fragment key={w.i}>
                {k > 0 && ' '}
                {renderWord(w)}
                {insertionsAfter(w.i)}
              </Fragment>
            ))}
          </p>
        ))
      )}
    </div>
  );
}
