// 1.5px line icons drawn to match the hairline book.

interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function IconPlay({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
    </svg>
  );
}

export function IconPause({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5.5 3.5v9M10.5 3.5v9" />
    </svg>
  );
}

export function IconMic({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
    </svg>
  );
}

export function IconStop({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function IconLeft({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

export function IconRight({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function IconTextSize({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M1.5 13 5 4l3.5 9M2.6 10.2h4.8M10 13l2.25-5.5L14.5 13M10.7 11.4h3.1" />
    </svg>
  );
}

export function IconPlus({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function IconMinus({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3.5 8h9" />
    </svg>
  );
}

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

export function IconFlag({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 14.5V2.5M4 3h7.5l-1.75 3 1.75 3H4" />
    </svg>
  );
}

export function IconDownload({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" />
    </svg>
  );
}

export function IconVolume({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2.5 6h2.5l4-3.5v11l-4-3.5H2.5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z" />
      <path d="M12 5.5a4 4 0 0 1 0 5M13.5 3.5a7 7 0 0 1 0 9" />
    </svg>
  );
}

export function IconClose({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
