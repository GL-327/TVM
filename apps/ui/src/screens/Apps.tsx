import { useEffect, useState } from 'react';
import { AppCard } from '../components/AppCard';
import { Ribbon } from '../components/Ribbon';
import { fallbackApps, fetchApps, isMockApp } from '../data/apps';
import { TVM_STREAM, type AppTile } from '../data/catalog';
import { applyPlanClass, fetchPlan } from '../data/plan';
import { enterTvmStream } from '../data/profiles';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Apps(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [grid, setGrid] = useState<AppTile[]>(() => fallbackApps().grid.filter((app) => app.id !== 'tvm-stream'));
  const [allowMocks, setAllowMocks] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchApps(), fetchPlan()]).then(([catalog, plan]) => {
      if (cancelled) return;
      applyPlanClass(plan);
      setAllowMocks(plan.mocks);
      setGrid(catalog.grid.filter((app) => app.id !== 'tvm-stream'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = allowMocks ? grid : grid.filter((app) => !isMockApp(app.id));

  return (
    <main className="page page--library">
      <Ribbon active="apps" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Your apps</p>
          <h1 className="page__heading">Apps</h1>
        </div>
      </header>
      <div className="app-grid" aria-label="Apps">
        <AppCard app={TVM_STREAM} id="app-tvm-stream" size="grid" onSelect={() => void enterTvmStream(navigate)} />
        {visible.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            id={`app-${app.id}`}
            size="grid"
            onSelect={() => navigate.push('service', { params: { id: app.id } })}
          />
        ))}
      </div>
    </main>
  );
}
