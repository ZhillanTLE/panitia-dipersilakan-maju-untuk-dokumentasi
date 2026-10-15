import { useEffect, useRef } from 'react';

interface MicLineProps {
  active: boolean;
  /** 0..1 loudness, polled every frame while active. */
  level: () => number;
}

/** A hairline that breathes with the reader's voice. Flat and grey when nobody is listening. */
export function MicLine({ active, level }: MicLineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const css = getComputedStyle(canvas);
    const ink = css.getPropertyValue('--ink').trim();
    const idle = css.getPropertyValue('--neutral-300').trim();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let smooth = 0;

    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      smooth = active ? smooth * 0.82 + levelRef.current() * 0.18 : 0;
      const amp = reduce ? 0 : smooth * (h / 2 - 2);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const envelope = Math.sin((Math.PI * x) / w);
        const y = h / 2 + Math.sin(x / 9 + t / 110) * Math.sin(x / 31 - t / 260) * amp * envelope;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = active ? ink : idle;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (active) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return <canvas ref={canvasRef} className="mic-line" aria-hidden="true" />;
}
