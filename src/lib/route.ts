import { useSyncExternalStore } from 'react';

export type View = 'kelas' | 'bacaan' | 'tinjau';

export interface Route {
  view: View;
  /** Path segment after the view, such as a session id in #/tinjau/<id>. */
  id?: string;
  params: URLSearchParams;
}

const VIEWS: View[] = ['kelas', 'bacaan', 'tinjau'];

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [view, id] = path.split('/');
  return {
    view: VIEWS.includes(view as View) ? (view as View) : 'bacaan',
    id: id ? decodeURIComponent(id) : undefined,
    params: new URLSearchParams(query),
  };
}

let current = parse(location.hash);
const listeners = new Set<() => void>();

window.addEventListener('hashchange', () => {
  current = parse(location.hash);
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function href(view: View, id?: string, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return `#/${view}${id ? `/${encodeURIComponent(id)}` : ''}${query}`;
}

export function navigate(view: View, id?: string, params?: Record<string, string>): void {
  location.hash = href(view, id, params);
}
