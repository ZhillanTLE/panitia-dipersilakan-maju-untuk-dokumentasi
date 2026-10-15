import { useSyncExternalStore } from 'react';

let message: { id: number; text: string } | null = null;
let timer = 0;
const listeners = new Set<() => void>();

export function toast(text: string): void {
  message = { id: Date.now(), text };
  listeners.forEach((l) => l());
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    message = null;
    listeners.forEach((l) => l());
  }, 2800);
}

export function Toaster() {
  const current = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => message,
  );
  return (
    <div role="status" aria-live="polite">
      {current && (
        <div key={current.id} className="toast">
          {current.text}
        </div>
      )}
    </div>
  );
}
