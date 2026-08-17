import { useNavigate } from '../nav/ViewStackContext';
import { enterTvmStream } from '../data/profiles';
import { FocusButton } from './FocusButton';

interface DockProps {
  active?: 'home' | 'library' | 'search' | 'live' | 'apps' | 'settings' | 'profile';
}

export function Dock({ active = 'home' }: DockProps): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <nav className="dock" aria-label="TVM">
      <FocusButton
        id="search"
        className={`dock__item${active === 'search' ? ' dock__item--on' : ''}`}
        onSelect={() => navigate.pushModal('search')}
      >
        Search
      </FocusButton>
      <FocusButton id="home-dock" className={`dock__item${active === 'home' ? ' dock__item--on' : ''}`} onSelect={() => navigate.home()}>
        Home
      </FocusButton>
      <FocusButton
        id="library"
        className={`dock__item${active === 'library' ? ' dock__item--on' : ''}`}
        onSelect={() => void enterTvmStream(navigate)}
      >
        Library
      </FocusButton>
      <FocusButton
        id="live"
        className={`dock__item${active === 'live' ? ' dock__item--on' : ''}`}
        onSelect={() => navigate.push('live')}
      >
        Live TV
      </FocusButton>
      <FocusButton
        id="apps"
        className={`dock__item${active === 'apps' ? ' dock__item--on' : ''}`}
        onSelect={() => navigate.push('apps')}
      >
        Apps
      </FocusButton>
      <FocusButton
        id="settings"
        className={`dock__item${active === 'settings' ? ' dock__item--on' : ''}`}
        onSelect={() => navigate.push('settings')}
      >
        Settings
      </FocusButton>
      <FocusButton
        id="profile"
        className={`dock__item dock__item--profile${active === 'profile' ? ' dock__item--on' : ''}`}
        onSelect={() => navigate.push('profile')}
      >
        Household
      </FocusButton>
    </nav>
  );
}
