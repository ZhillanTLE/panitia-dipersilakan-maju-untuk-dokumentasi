import { useEffect, useState } from 'react';
import { href, type View } from '../lib/route';
import { S } from '../strings';
import './Navbar.css';

interface NavbarProps {
  view: View;
  pending: number;
}

const LINKS: View[] = ['kelas', 'bacaan', 'tinjau', 'rencana'];

export function Navbar({ view, pending }: NavbarProps) {
  const offline = useOfflineReady();
  return (
    <header className="nav">
      <a className="nav__brand" href={href('bacaan')}>
        <img className="nav__logo" src="./logo.png" alt="" width={318} height={330} />
        {S.brand}
      </a>
      <nav aria-label={S.nav.label}>
        <ul className="nav__links">
          {LINKS.map((v, k) => (
            <li key={v}>
              <a
                className="nav__link"
                href={href(v)}
                aria-current={view === v ? 'page' : undefined}
                title={S.nav.hint[v]}
              >
                <span className="nav__step" aria-hidden="true">
                  {k + 1}
                </span>
                {S.nav[v]}
                {v === 'tinjau' && pending > 0 && (
                  <span className="nav__count" aria-label={S.nav.pending(pending)}>
                    {pending}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="nav__status">{offline && S.offlineReady}</p>
    </header>
  );
}

/** True once the service worker controls the page, so the app opens in airplane mode. */
function useOfflineReady(): boolean {
  const [ready, setReady] = useState(() => Boolean(navigator.serviceWorker?.controller));
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const update = () => setReady(Boolean(sw.controller));
    sw.addEventListener('controllerchange', update);
    void sw.ready.then(update);
    return () => sw.removeEventListener('controllerchange', update);
  }, []);
  return ready;
}
