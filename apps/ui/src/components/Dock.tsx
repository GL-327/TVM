import { Ribbon } from './Ribbon';

interface DockProps {
  active?: 'home' | 'library' | 'search' | 'live' | 'apps' | 'settings' | 'profile' | 'watchlist';
}

/** Same top pill as Home. Kept so older screens can still import Dock. */
export function Dock({ active = 'home' }: DockProps): React.JSX.Element {
  return <Ribbon active={active} />;
}
