import { useId, useLayoutEffect, useRef, useState } from 'react';
import './Trail.css';

interface TrailProps {
  /** Named stops along the story, one per block. Empty for cards that are not a story. */
  stops: string[];
  /** 0..1 share of the card already read. */
  progress: number;
  /** Block the reader is in, so its stop lights up. */
  block: number;
  /** At the end of the card: the walker raises its arms. The same for every child. */
  cheer?: boolean;
}

type Landmark = 'planet' | 'rose' | 'star' | 'stars' | 'fox' | 'well' | 'lamp';

/** Picks a drawing for a stop from its name; unknown names cycle through the set. */
function landmarkFor(name: string, k: number): Landmark {
  const n = name.toLowerCase();
  if (/bintang kecil|planet|asteroid/.test(n)) return 'planet';
  if (/mawar|bunga/.test(n)) return 'rose';
  if (/rubah/.test(n)) return 'fox';
  if (/sumur|air/.test(n)) return 'well';
  if (/lampu/.test(n)) return 'lamp';
  if (/perjalanan|bintang-bintang/.test(n)) return 'stars';
  if (/bintang|langit/.test(n)) return 'star';
  return (['planet', 'stars', 'rose', 'fox', 'well'] as Landmark[])[k % 5];
}

const PAD = 30;
/** Landmarks stand this far above the path, so the walker passes below them, never on top. */
const LIFT = 38;

/**
 * Jejak pasir, drawn like a sketchbook: ink lines on the paper, a dotted path, and small hand-drawn landmarks for the story's stops. A walker follows the
 * reader. Progress without a number or a score.
 */
export function Trail({ stops, progress, block, cheer }: TrailProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const filterId = `sketch-${useId().replace(/:/g, '')}`;
  const [width, setWidth] = useState(0);
  const [geo, setGeo] = useState<{ length: number; walker: DOMPoint; stops: DOMPoint[] } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setWidth(root.clientWidth));
    observer.observe(root);
    setWidth(root.clientWidth);
    return () => observer.disconnect();
  }, []);

  const named = stops.length > 0;
  const h = named ? 150 : 64;
  const w = Math.max(width, 2 * PAD + 1);
  const y = named ? 108 : 46;
  const d = `M ${PAD} ${y + 4} C ${w * 0.2} ${y - 18}, ${w * 0.32} ${y + 18}, ${w * 0.5} ${y} S ${w * 0.8} ${y - 16}, ${w - PAD} ${y + 2}`;

  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path || !width) return;
    const length = path.getTotalLength();
    const at = (f: number) => path.getPointAtLength(length * Math.min(1, Math.max(0, f)));
    setGeo({
      length,
      walker: at(progress),
      stops: stops.map((_, k) => at(stops.length === 1 ? 0 : k / (stops.length - 1))),
    });
  }, [d, progress, stops, width]);

  return (
    <div className="trail" ref={rootRef} style={{ height: h }} aria-hidden="true">
      {width > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <defs>
            {/* A slight wobble on every line, so it reads as drawn by hand */}
            <filter id={filterId} x="-5%" y="-20%" width="110%" height="140%">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" />
              <feDisplacementMap in="SourceGraphic" scale="2.2" />
            </filter>
          </defs>
          <g filter={`url(#${filterId})`}>
            <path ref={pathRef} d={d} className="trail__path" />
            {geo && (
              <>
                <path
                  d={d}
                  className="trail__walked"
                  style={{ strokeDasharray: `${geo.length} ${geo.length}`, strokeDashoffset: geo.length * (1 - progress) }}
                />
                {geo.stops.map((pt, k) => (
                  <g key={k} className="trail__stop" data-on={k <= block ? '' : undefined}>
                    <path className="sk sk--faint" d={`M ${pt.x} ${pt.y - 6} V ${pt.y - LIFT + 4}`} strokeDasharray="1 4" />
                    <g transform={`translate(${pt.x} ${pt.y - LIFT}) scale(1.35)`}>
                      <Sketch kind={landmarkFor(stops[k], k)} />
                    </g>
                  </g>
                ))}
                {!named && (
                  <>
                    <circle className="sk" cx={PAD} cy={y + 4} r={3.5} />
                    <g transform={`translate(${w - PAD} ${y - 2})`}>
                      <Sketch kind="star" />
                    </g>
                  </>
                )}
                <g className="trail__walker" style={{ transform: `translate(${geo.walker.x}px, ${geo.walker.y}px)` }}>
                  <Walker cheer={cheer} />
                </g>
              </>
            )}
          </g>
          {/* Labels stay crisp, outside the hand-drawn wobble */}
          {geo?.stops.map((pt, k) => (
            <text
              key={k}
              className="trail__label"
              data-on={k <= block ? '' : undefined}
              x={pt.x}
              y={pt.y + 28}
              textAnchor={k === 0 ? 'start' : k === stops.length - 1 ? 'end' : 'middle'}
              dx={k === 0 ? -PAD + 6 : k === stops.length - 1 ? PAD - 6 : 0}
            >
              {stops[k]}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

function starPath(x: number, y: number, r: number): string {
  let d = '';
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI / 5) * k - Math.PI / 2;
    const rr = k % 2 ? r * 0.45 : r;
    d += `${k ? 'L' : 'M'} ${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)} `;
  }
  return `${d}Z`;
}

/** Original line drawings for the stops. Ink only, with a touch of green on stems. */
function Sketch({ kind }: { kind: Landmark }) {
  switch (kind) {
    case 'planet':
      // A tiny round world with three little volcanoes and a flower.
      return (
        <g className="lm">
          <circle className="sk" cx={0} cy={-16} r={13} />
          <path className="sk" d="M -9 -26 l 3 -6 l 3 6 M -2 -29 l 3 -6 l 3 6 M 5 -27 l 2.5 -5 l 2.5 5" />
          <path className="sk sk--leaf" d="M 11 -24 q 3 -6 1 -12" />
          <circle className="sk" cx={12} cy={-38} r={2.6} />
          <path className="sk sk--faint" d="M -7 -14 q 4 3 9 1" />
        </g>
      );
    case 'rose':
      return (
        <g className="lm">
          <path className="sk sk--leaf" d="M 0 0 C 1 -8, -1 -16, 0 -24 M 0 -12 q -6 -2 -8 2 q 4 2 8 -2" />
          <path className="sk" d="M 0 -24 c -6 0 -7 -6 -4 -9 c 2 -3 7 -3 8 0 c 2 3 0 7 -4 7 M -1 -30 c 2 -1 4 0 3 2" />
        </g>
      );
    case 'star':
      return (
        <g className="lm">
          <path className="sk" d={starPath(0, -18, 11)} />
          <path className="sk sk--faint" d="M -16 -30 l 3 3 M 15 -6 l 3 2" />
        </g>
      );
    case 'stars':
      // A few small worlds on their orbits.
      return (
        <g className="lm">
          <path className="sk sk--faint" d="M -22 -16 C -14 -28, 14 -28, 22 -16" strokeDasharray="2 4" />
          <circle className="sk" cx={-14} cy={-20} r={5} />
          <circle className="sk" cx={4} cy={-28} r={7} />
          <path className="sk" d="M -5 -27 q 9 -6 18 2" />
          <circle className="sk" cx={18} cy={-16} r={3.5} />
          <path className="sk" d={starPath(-2, -8, 4)} />
        </g>
      );
    case 'fox':
      // A small fox sitting, tail curled round.
      return (
        <g className="lm">
          <path className="sk" d="M -6 -26 l -2 -8 l 6 5 l 4 0 l 6 -5 l -2 8 c 0 5 -4 8 -6 8 c -2 0 -6 -3 -6 -8 z" />
          <path className="sk" d="M -5 -18 c -4 4 -5 12 -3 18 h 14 c 2 -6 1 -14 -3 -18" />
          <path className="sk" d="M 6 0 c 8 0 14 -4 12 -11 c -1 -4 -5 -4 -6 -1" />
          <circle className="sk sk--dot" cx={-2.5} cy={-25} r={0.9} />
          <circle className="sk sk--dot" cx={2.5} cy={-25} r={0.9} />
        </g>
      );
    case 'well':
      return (
        <g className="lm">
          <path className="sk" d="M -12 0 v -12 c 6 -3 18 -3 24 0 v 12 M -12 -12 c 6 3 18 3 24 0" />
          <path className="sk" d="M -9 -13 v -16 M 9 -13 v -16 M -12 -29 h 24" />
          <circle className="sk" cx={0} cy={-29} r={3} />
          <path className="sk sk--faint" d="M 0 -26 v 8 M -8 -5 h 4 M 2 -7 h 5" />
        </g>
      );
    case 'lamp':
      return (
        <g className="lm">
          <path className="sk" d="M 0 0 v -28 M -4 0 h 8 M -5 -28 h 10 l -2 -6 h -6 z" />
          <path className="sk sk--faint" d="M -9 -36 l -3 -2 M 9 -36 l 3 -2 M 0 -39 v -3" />
        </g>
      );
  }
}

/** The walker: an original little sketched sprout, hopping along the line. */
function Walker({ cheer }: { cheer?: boolean }) {
  return (
    <g className="walker" transform="translate(0 -14)">
      <g className={cheer ? 'walker__hop walker__hop--cheer' : 'walker__hop'}>
        {cheer && <path className="sk" d="M -8 2 l -6 -9 M 8 2 l 6 -9" />}
        <path className="sk sk--leaf" d="M 0 -9 c -1 -5 -6 -7 -8 -5 c 2 3 5 4 8 5 M 0 -9 c 1 -5 6 -6 7 -4 c -2 3 -4 3 -7 4" />
        <circle className="walker__body" cx={0} cy={0} r={9} />
        <circle className="sk sk--dot" cx={-3} cy={-1} r={1} />
        <circle className="sk sk--dot" cx={3} cy={-1} r={1} />
        <path className="sk" d="M -2 3 q 2 2 4 0 M -4 9 l -1 4 M 4 9 l 1 4" />
      </g>
    </g>
  );
}

/** A scatter of sketched stars that pop in one after another. Decoration for the ending page. */
export function SketchStars() {
  const filterId = `stars-${useId().replace(/:/g, '')}`;
  // In a 520 x 170 box around the title: margins left, right and above, never over the words.
  const stars: [number, number, number][] = [
    [22, 56, 9],
    [44, 128, 6],
    [78, 14, 5],
    [260, 4, 4],
    [446, 12, 5],
    [496, 50, 8],
    [478, 126, 6],
  ];
  return (
    <svg className="sketch-stars" viewBox="0 0 520 170" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <filter id={filterId} x="-10%" y="-20%" width="120%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="5" />
          <feDisplacementMap in="SourceGraphic" scale="2" />
        </filter>
      </defs>
      <g filter={`url(#${filterId})`}>
        {stars.map(([x, y, r], k) => (
          <path key={k} className="sk sketch-stars__one" d={starPath(x, y + r, r)} style={{ animationDelay: `${500 + k * 140}ms` }} />
        ))}
      </g>
    </svg>
  );
}
