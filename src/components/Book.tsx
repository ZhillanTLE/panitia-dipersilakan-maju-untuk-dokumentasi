import { useLayoutEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import './Book.css';

interface BookProps {
  /** Changing the key turns the page. */
  pageKey: string;
  direction?: 'forward' | 'back';
  dark?: boolean;
  /** How many pages fan out behind the front page. */
  behind?: number;
  onNext?: () => void;
  onPrev?: () => void;
  nextLabel?: string;
  className?: string;
  /** Rendered beside the page and never turned with it, such as index tabs. */
  aside?: ReactNode;
  children: ReactNode;
}

const SWIPE_PX = 56;

/**
 * A single-page book. The page that leaves is a static snapshot of its last frame,
 * so the leaf that turns always shows exactly what was on screen.
 */
export function Book({ pageKey, direction = 'forward', dark, behind = 2, onNext, onPrev, nextLabel, className, aside, children }: BookProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const snapshot = useRef<{ key: string; node: HTMLElement; dark: boolean } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const layer = layerRef.current;
    if (!page || !layer) return;
    const previous = snapshot.current;
    if (previous && previous.key !== pageKey) turnPage(layer, previous, page, Boolean(dark), direction);
    snapshot.current = { key: pageKey, node: clonePage(page), dark: Boolean(dark) };
  });

  const onPointerDown = (e: PointerEvent) => {
    if (onNext || onPrev) swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  return (
    <div
      className={`book${aside ? ' book--tabbed' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
    >
      {Array.from({ length: behind }, (_, k) => (
        <div key={k} className="book__behind" style={{ '--k': behind - k } as CSSProperties} aria-hidden="true" />
      ))}
      <div ref={pageRef} className={`page${dark ? ' page--dark' : ''}`}>
        {children}
      </div>
      {onNext && behind > 0 && (
        <button type="button" className="book__edge" onClick={onNext} aria-label={nextLabel} tabIndex={-1} />
      )}
      <div ref={layerRef} className="book__layer" aria-hidden="true" inert />
      {aside}
    </div>
  );
}

/** Reads a CSS time token. Minifiers may rewrite 760ms as .76s, so the unit matters. */
function cssTimeMs(value: string, fallback: number): number {
  const v = value.trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n;
}

/** Static copy of a page for the turning leaf. Popovers marked data-no-snapshot stay behind. */
function clonePage(page: HTMLElement): HTMLElement {
  const copy = page.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-no-snapshot]').forEach((el) => el.remove());
  return copy;
}

// Each face shows for its own half of the turn. The page easing is symmetric, so the leaf
// is edge-on exactly at the time midpoint. Fades live on the faces, never on the leaf:
// opacity on the leaf would flatten its 3D context.
const SHOW_FIRST_HALF: Keyframe[] = [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }];
const SHOW_SECOND_HALF: Keyframe[] = [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }];

function face(node: Node, side: 'front' | 'back', dark = false): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `leaf__face leaf__face--${side}${dark ? ' is-dark' : ''}`;
  el.append(node);
  return el;
}

function overlay(className: string, node?: Node): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  if (node) el.append(node);
  return el;
}

function turnPage(
  layer: HTMLElement,
  previous: { node: HTMLElement; dark: boolean },
  live: HTMLElement,
  liveDark: boolean,
  direction: 'forward' | 'back',
): void {
  layer.replaceChildren();
  const duration = cssTimeMs(getComputedStyle(layer).getPropertyValue('--turn-ms'), 760);
  const easing = 'cubic-bezier(0.645, 0.045, 0.355, 1)';

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const ghost = overlay('turn-under', previous.node);
    layer.append(ghost);
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' }).finished.then(
      () => ghost.remove(),
      () => ghost.remove(),
    );
    return;
  }

  const leaf = overlay('leaf');
  const shade = overlay('leaf__shade');
  const cast = overlay('turn-cast');
  const cleanup = () => layer.replaceChildren();

  if (direction === 'forward') {
    // The old page lifts off to the left and reveals the new page underneath.
    const front = face(previous.node, 'front');
    const back = face(document.createElement('div'), 'back', previous.dark);
    front.append(shade);
    leaf.append(front, back);
    layer.append(cast, leaf);
    front.animate(SHOW_FIRST_HALF, { duration, fill: 'forwards' });
    back.animate([...SHOW_SECOND_HALF.slice(0, 3), { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration, fill: 'forwards' });
    cast.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.8, easing: 'ease-out', fill: 'forwards' });
    shade.animate([{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration, easing });
    leaf
      .animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }], { duration, easing, fill: 'forwards' })
      .finished.then(cleanup, cleanup);
  } else {
    // The new page swings back in from the left over the old one.
    const under = overlay('turn-under', previous.node);
    const front = face(clonePage(live), 'front');
    const back = face(document.createElement('div'), 'back', liveDark);
    front.append(shade);
    leaf.append(front, back);
    layer.append(under, leaf);
    back.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, ...SHOW_FIRST_HALF.slice(1)], { duration, fill: 'forwards' });
    front.animate(SHOW_SECOND_HALF, { duration, fill: 'forwards' });
    shade.animate([{ opacity: 0 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], { duration, easing });
    leaf
      .animate([{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }], { duration, easing, fill: 'forwards' })
      .finished.then(cleanup, cleanup);
  }
}

interface PageFootProps {
  left?: ReactNode;
  right?: ReactNode;
}

export function PageFoot({ left, right }: PageFootProps) {
  return (
    <footer className="page__foot">
      <span>{left}</span>
      <span>{right}</span>
    </footer>
  );
}
