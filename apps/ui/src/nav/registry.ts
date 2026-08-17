import type { ComponentType } from 'react';
import { Apps } from '../screens/Apps';
import { Checkout } from '../screens/Checkout';
import { ConfirmModal } from '../screens/ConfirmModal';
import { Details } from '../screens/Details';
import { Developer } from '../screens/Developer';
import { DeveloperUnlock } from '../screens/DeveloperUnlock';
import { DiagnosticsModal } from '../screens/DiagnosticsModal';
import { Home } from '../screens/Home';
import { Library } from '../screens/Library';
import { Watchlist } from '../screens/Watchlist';
import { LivePlaylist } from '../screens/LivePlaylist';
import { LiveTV } from '../screens/LiveTV';
import { NoticeModal } from '../screens/NoticeModal';
import { Player } from '../screens/Player';
import { Plans } from '../screens/Plans';
import { Profile } from '../screens/Profile';
import { Profiles } from '../screens/Profiles';
import { RealDebrid } from '../screens/RealDebrid';
import { Recovery } from '../screens/Recovery';
import { SearchModal } from '../screens/SearchModal';
import { Service } from '../screens/Service';
import { Settings } from '../screens/Settings';
import { Setup } from '../screens/Setup';
import { SystemInfo } from '../screens/SystemInfo';
import { Updates } from '../screens/Updates';

export interface ScreenProps {
  params: Readonly<Record<string, unknown>>;
}

export interface ScreenDefinition {
  component: ComponentType<ScreenProps>;
  defaultFocus?: string | ((params: Readonly<Record<string, unknown>>) => string | undefined);
}

const SCREENS: Readonly<Record<string, ScreenDefinition>> = {
  home: { component: Home, defaultFocus: 'home-dock' },
  library: { component: Library, defaultFocus: 'stream-search' },
  watchlist: { component: Watchlist, defaultFocus: 'watchlist-home' },
  live: { component: LiveTV, defaultFocus: 'live-settings' },
  'live-playlist': { component: LivePlaylist, defaultFocus: 'url' },
  apps: { component: Apps, defaultFocus: 'app-tvm-stream' },
  service: { component: Service, defaultFocus: 'service-back' },
  profile: { component: Profile, defaultFocus: 'realdebrid' },
  profiles: { component: Profiles, defaultFocus: 'profile-pick' },
  details: { component: Details, defaultFocus: 'back' },
  settings: { component: Settings, defaultFocus: 'plan' },
  plans: { component: Plans, defaultFocus: 'plan-free' },
  checkout: {
    component: Checkout,
    defaultFocus: (params) => (params['planId'] === 'free' ? 'pay' : 'card-name'),
  },
  developer: { component: Developer, defaultFocus: 'dev-free' },
  'developer-unlock': { component: DeveloperUnlock, defaultFocus: 'dev-password' },
  'system-info': { component: SystemInfo, defaultFocus: 'back' },
  updates: { component: Updates, defaultFocus: 'check' },
  realdebrid: { component: RealDebrid, defaultFocus: 'token' },
  setup: { component: Setup, defaultFocus: 'token' },
  recovery: { component: Recovery, defaultFocus: 'settings' },
  diagnostics: { component: DiagnosticsModal, defaultFocus: 'close' },
  confirm: { component: ConfirmModal, defaultFocus: 'confirm' },
  notice: { component: NoticeModal, defaultFocus: 'close' },
  search: { component: SearchModal, defaultFocus: 'close' },
  player: { component: Player, defaultFocus: 'pause' },
};

export function screenDefinition(name: string): ScreenDefinition {
  return SCREENS[name] ?? SCREENS.home ?? { component: Home, defaultFocus: 'hero-play' };
}
