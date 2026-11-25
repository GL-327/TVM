import { BackButton } from './BackButton';
import { useCoreHealth } from '../useCoreHealth';
import { useNavigate } from '../nav/ViewStackContext';

interface TopBarProps {
  title?: string;
}

/** Nested-screen chrome: Back + title + core. Ribbon destinations do not use this. */
export function TopBar({ title = 'TVM' }: TopBarProps): React.JSX.Element {
  const navigate = useNavigate();
  const health = useCoreHealth();

  return (
    <header className="topbar">
      <BackButton id="top-back" onSelect={() => navigate.pop()} />
      <p className="topbar__brand">{title}</p>
      <span className={`status status--${health.status}`}>
        <span className="status__dot" aria-hidden="true" />
        {health.status === 'online' && `Core ${health.version}`}
        {health.status === 'connecting' && 'Connecting'}
        {health.status === 'offline' && 'Core unavailable'}
      </span>
    </header>
  );
}
