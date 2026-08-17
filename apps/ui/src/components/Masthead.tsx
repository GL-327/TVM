import { BrandLockup } from './BrandLockup';
import { useCoreHealth } from '../useCoreHealth';

export function Masthead(): React.JSX.Element {
  const health = useCoreHealth();

  return (
    <div className="masthead">
      <BrandLockup kind="wordmark" />
      <span className={`status status--${health.status}`}>
        <span className="status__dot" aria-hidden="true" />
        {health.status === 'online' && 'Ready'}
        {health.status === 'connecting' && 'Connecting'}
        {health.status === 'offline' && 'Offline'}
      </span>
    </div>
  );
}
