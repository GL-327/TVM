import type { AppTile } from '../data/catalog';
import { FocusButton } from './FocusButton';

interface AppCardProps {
  app: AppTile;
  id: string;
  onSelect: () => void;
  size?: 'ribbon' | 'grid';
}

export function AppCard({ app, id, onSelect, size = 'ribbon' }: AppCardProps): React.JSX.Element {
  return (
    <FocusButton id={id} className={`app-card app-card--${size} app-card--${app.id}`} onSelect={onSelect}>
      <span className="app-card__art" style={{ background: app.accent }}>
        {app.icon !== undefined ? (
          <img className="app-card__icon" src={app.icon} alt="" />
        ) : (
          <span className="app-card__wordmark">{app.wordmark ?? app.name}</span>
        )}
        {size === 'grid' && <span className="app-card__name">{app.name}</span>}
      </span>
    </FocusButton>
  );
}
