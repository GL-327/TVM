import { FocusButton } from './FocusButton';
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
      <FocusButton id="top-back" variant="quiet" onSelect={() => navigate.pop()}>
        Back
      </FocusButton>
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
