import { FocusButton } from './FocusButton';
import { enterTvmStream } from '../data/profiles';
import { useCoreHealth } from '../useCoreHealth';
import { useNavigate } from '../nav/ViewStackContext';

interface TopBarProps {
  title?: string;
}

export function TopBar({ title = 'TVM' }: TopBarProps): React.JSX.Element {
  const navigate = useNavigate();
  const health = useCoreHealth();

  return (
    <header className="topbar">
      <p className="topbar__brand">{title}</p>
      <nav className="topbar__nav" aria-label="Home">
        <FocusButton id="library" variant="quiet" onSelect={() => void enterTvmStream(navigate)}>
          Library
        </FocusButton>
        <FocusButton
          id="search"
          variant="quiet"
          onSelect={() => navigate.pushModal('search')}
        >
          Search
        </FocusButton>
        <FocusButton id="settings" variant="quiet" onSelect={() => navigate.push('settings')}>
          Settings
        </FocusButton>
        <FocusButton
          id="profile"
          variant="quiet"
          onSelect={() => navigate.push('profile')}
        >
          Household
        </FocusButton>
      </nav>
      <span className={`status status--${health.status}`}>
        <span className="status__dot" aria-hidden="true" />
        {health.status === 'online' && `Core ${health.version}`}
        {health.status === 'connecting' && 'Connecting'}
        {health.status === 'offline' && 'Core unavailable'}
      </span>
    </header>
  );
}
