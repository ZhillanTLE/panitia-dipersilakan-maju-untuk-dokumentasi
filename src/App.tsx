import { useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Toaster } from './components/Toast';
import { useRoute } from './lib/route';
import { useApp } from './lib/store';
import { S } from './strings';
import { ClassView } from './views/ClassView';
import { PlannerView } from './views/PlannerView';
import { ReadView } from './views/ReadView';
import { ReviewView } from './views/ReviewView';

export function App() {
  const route = useRoute();
  const app = useApp();
  const pending = app.sessions.filter((s) => s.take_ids.length && s.suggestion?.status !== 'confirmed').length;

  useEffect(() => {
    document.title = `${S.nav[route.view]} – ${S.brand}`;
    window.scrollTo(0, 0);
  }, [route.view]);

  return (
    <>
      <Navbar view={route.view} pending={pending} />
      {!app.persistent && <p className="banner">{S.storageOff}</p>}
      <main id="main">
        {app.ready && (
          <>
            {/* Bacaan stays mounted so a session survives a look at Kelas or Tinjau. */}
            <div hidden={route.view !== 'bacaan'}>
              <ReadView active={route.view === 'bacaan'} />
            </div>
            {route.view === 'tinjau' && <ReviewView active sessionId={route.id} />}
            {route.view === 'kelas' && <ClassView />}
            {route.view === 'rencana' && <PlannerView step={route.params.get('langkah')} />}
          </>
        )}
      </main>
      <Toaster />
    </>
  );
}
