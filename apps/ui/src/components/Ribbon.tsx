import { useEffect, useState } from 'react';
import { fallbackApps, fetchApps, isMockApp } from '../data/apps';
import { applyPlanClass, fetchPlan, mockAppLocked } from '../data/plan';
import { TVM_STREAM, type AppTile } from '../data/catalog';
import { enterTvmStream } from '../data/profiles';
import { useNavigate } from '../nav/ViewStackContext';
import { AppCard } from './AppCard';
import { FocusButton } from './FocusButton';
import {
  IconApps,
  IconHome,
  IconInputs,
  IconLive,
  IconProfile,
  IconSearch,
  IconSettings,
  IconWatchlist,
} from './Icons';

interface RibbonProps {
  active?: 'home' | 'library' | 'search' | 'live' | 'apps' | 'settings' | 'profile' | 'watchlist';
}

export function Ribbon({ active = 'home' }: RibbonProps): React.JSX.Element {
  const navigate = useNavigate();
  const [apps, setApps] = useState<AppTile[]>(() => fallbackApps().ribbon.filter((app) => app.id !== 'tvm-stream'));
  const [allowMocks, setAllowMocks] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchApps(), fetchPlan()]).then(([catalog, plan]) => {
      if (cancelled) return;
      applyPlanClass(plan);
      setAllowMocks(plan.mocks);
      setApps(catalog.ribbon.filter((app) => app.id !== 'tvm-stream'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = apps;

  return (
    <nav className="ribbon" aria-label="TVM">
      <FocusButton
        id="profile"
        className={`ribbon__icon${active === 'profile' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => navigate.push('profile')}
      >
        <IconProfile className="ribbon__avatar-svg" />
        <span className="ribbon__label">Profile</span>
      </FocusButton>
      <FocusButton
        id="inputs"
        className="ribbon__icon"
        onSelect={() =>
          navigate.pushModal('notice', {
            params: {
              title: 'Inputs',
              body: 'This computer outputs over HDMI. Switch the television input to this device to watch TVM.',
            },
          })
        }
      >
        <span className="ribbon__glyph">
          <IconInputs />
        </span>
        <span className="ribbon__label">Inputs</span>
      </FocusButton>
      <FocusButton
        id="search"
        className={`ribbon__icon${active === 'search' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => navigate.pushModal('search')}
      >
        <span className="ribbon__glyph">
          <IconSearch />
        </span>
        <span className="ribbon__label">Search</span>
      </FocusButton>
      <FocusButton
        id="home-dock"
        className={`ribbon__icon${active === 'home' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => navigate.home()}
      >
        <span className="ribbon__glyph">
          <IconHome />
        </span>
        <span className="ribbon__label">Home</span>
      </FocusButton>
      <FocusButton
        id="live"
        className={`ribbon__icon${active === 'live' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => navigate.push('live')}
      >
        <span className="ribbon__glyph">
          <IconLive />
        </span>
        <span className="ribbon__label">Live TV</span>
      </FocusButton>
      <FocusButton
        id="watchlist"
        className={`ribbon__icon${active === 'watchlist' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => navigate.push('watchlist')}
      >
        <span className="ribbon__glyph">
          <IconWatchlist />
        </span>
        <span className="ribbon__label">Watchlist</span>
      </FocusButton>

      <AppCard app={TVM_STREAM} id="library" onSelect={() => void enterTvmStream(navigate)} />
      {visible.map((app) => (
        <AppCard
          key={app.id}
          app={app}
          id={`app-${app.id}`}
          locked={mockAppLocked(allowMocks, isMockApp(app.id))}
          onSelect={() => navigate.push('service', { params: { id: app.id } })}
        />
      ))}

      <FocusButton
        id="apps"
        className={`ribbon__icon${active === 'apps' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => navigate.push('apps')}
      >
        <span className="ribbon__glyph">
          <IconApps />
        </span>
        <span className="ribbon__label">Apps</span>
      </FocusButton>
      <FocusButton
        id="settings"
        className={`ribbon__icon${active === 'settings' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => navigate.push('settings')}
      >
        <span className="ribbon__glyph">
          <IconSettings />
        </span>
        <span className="ribbon__label">Settings</span>
      </FocusButton>
    </nav>
  );
}
