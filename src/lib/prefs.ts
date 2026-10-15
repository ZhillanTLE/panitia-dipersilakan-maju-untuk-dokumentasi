import type { Source } from '../types';

// Per-device conveniences only. Anything that must persist goes through the store.

export type TextSize = 0 | 1 | 2;

interface Prefs {
  source: Source;
  textSize: TextSize;
}

const KEY = 'dengarbaca.prefs';
const DEFAULTS: Prefs = { source: 'manual', textSize: 0 };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    // Storage blocked: the preference lasts until the page closes.
  }
}
