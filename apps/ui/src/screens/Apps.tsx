import { useEffect, useState } from 'react';
import { AppCard } from '../components/AppCard';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import { appTileOpen, fallbackApps, fetchApps, prefetchAppHub } from '../data/apps';
import { TVM_STREAM, type AppTile } from '../data/catalog';
import { applyPlanClass, fetchPlan } from '../data/plan';
import { enterTvmStream } from '../data/profiles';
import { focusExists, requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate, type Navigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

function openAppTile(navigate: Navigate, app: AppTile): void {
  const dest = appTileOpen(app.id);
  if (dest.kind === 'library') {
    void enterTvmStream(navigate);
    return;
  }
  prefetchAppHub(dest.id);
  navigate.push('service', { params: { id: dest.id } });
}

export function Apps(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const [grid, setGrid] = useState<AppTile[]>(() => fallbackApps().grid.filter((app) => app.id !== 'tvm-stream'));

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchApps(), fetchPlan()]).then(([catalog, plan]) => {
      if (cancelled) return;
      applyPlanClass(plan);
      setGrid(catalog.grid.filter((app) => app.id !== 'tvm-stream'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const screen = document.querySelector('[data-screen="apps"]');
      if (screen?.querySelector('.app-grid [data-focused="true"]') !== null) {
        window.clearInterval(timer);
        return;
      }
      const first = screen?.querySelector<HTMLElement>('.app-grid [data-focus-id]');
      const id = first?.getAttribute('data-focus-id');
      const key = id !== null && id !== undefined && id !== '' ? `${scope}/${id}` : `${scope}/app-tvm-stream`;
      if (focusExists(key)) {
        requestFocus(key);
        window.clearInterval(timer);
        return;
      }
      if (attempts > 12) window.clearInterval(timer);
    }, 16);
    return () => window.clearInterval(timer);
  }, [scope]);

  return (
    <main className="page page--library page--docked">
      <PageScene />
      <Ribbon active="apps" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Your apps</p>
          <h1 className="page__heading">Apps</h1>
          <p className="page__lede">Open a service hub or TVM Stream. Playback still uses this machine.</p>
        </div>
      </header>
      <div className="app-grid" data-wrap="grid" aria-label="Apps">
        <AppCard app={TVM_STREAM} id="app-tvm-stream" size="grid" onSelect={() => openAppTile(navigate, TVM_STREAM)} />
        {grid.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            id={`app-${app.id}`}
            size="grid"
            onSelect={() => openAppTile(navigate, app)}
          />
        ))}
      </div>
    </main>
  );
}
