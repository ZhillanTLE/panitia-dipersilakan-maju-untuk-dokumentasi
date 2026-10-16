import { useLayoutEffect, useRef, useState } from 'react';
import './Trail.css';

interface TrailProps {
  /** Named stops along the story, one per block. Empty for cards that are not a story. */
  stops: string[];
  /** 0..1 share of the card already read. */
  progress: number;
  /** Block the reader is in, so its stop lights up. */
  block: number;
}

const PAD = 14;

/**
 * Jejak pasir: the card as a walk across the sand. A walker follows the reader along a
 * dotted path, past the story's stops. Progress without a number or a score.
 */
export function Trail({ stops, progress, block }: TrailProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
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

  const height = stops.length ? 78 : 34;
  const mid = stops.length ? 30 : 17;
  const w = Math.max(width, 2 * PAD + 1);
  // A gentle dune line: up, down, up again, across the full width.
  const d = `M ${PAD} ${mid + 8} C ${w * 0.2} ${mid - 22}, ${w * 0.32} ${mid + 30}, ${w * 0.5} ${mid + 2} S ${w * 0.82} ${mid - 20}, ${w - PAD} ${mid + 8}`;

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
    <div className="trail" ref={rootRef} style={{ height }} aria-hidden="true">
      {width > 0 && (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
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
                  <circle cx={pt.x} cy={pt.y} r={5.5} />
                  <text
                    x={pt.x}
                    y={pt.y + 24}
                    textAnchor={k === 0 ? 'start' : k === stops.length - 1 ? 'end' : 'middle'}
                    dx={k === 0 ? -PAD + 2 : k === stops.length - 1 ? PAD - 2 : 0}
                  >
                    {stops[k]}
                  </text>
                </g>
              ))}
              {!stops.length && (
                <>
                  <circle className="trail__end" cx={PAD} cy={mid + 8} r={3} />
                  <circle className="trail__end" cx={w - PAD} cy={mid + 8} r={3} />
                </>
              )}
              <circle className="trail__walker" r={6} style={{ transform: `translate(${geo.walker.x}px, ${geo.walker.y}px)` }} />
            </>
          )}
        </svg>
      )}
    </div>
  );
}
