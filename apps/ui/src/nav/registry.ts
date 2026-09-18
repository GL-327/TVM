import { lazy, type ComponentType } from 'react';
import { ConfirmModal } from '../screens/ConfirmModal';
import { Home } from '../screens/Home';
import { NoticeModal } from '../screens/NoticeModal';

// Keep Home and lightweight notices ready; fetch secondary screens on demand.
const Account = lazy(() => import('../screens/Account').then((m) => ({ default: m.Account })));
const Accounts = lazy(() => import('../screens/Accounts').then((m) => ({ default: m.Accounts })));
const Apps = lazy(() => import('../screens/Apps').then((m) => ({ default: m.Apps })));
const Donate = lazy(() => import('../screens/Donate').then((m) => ({ default: m.Donate })));
const Details = lazy(() => import('../screens/Details').then((m) => ({ default: m.Details })));
const Developer = lazy(() => import('../screens/Developer').then((m) => ({ default: m.Developer })));
const DeveloperUnlock = lazy(() => import('../screens/DeveloperUnlock').then((m) => ({ default: m.DeveloperUnlock })));
const DiagnosticsModal = lazy(() => import('../screens/DiagnosticsModal').then((m) => ({ default: m.DiagnosticsModal })));
const Library = lazy(() => import('../screens/Library').then((m) => ({ default: m.Library })));
const Watchlist = lazy(() => import('../screens/Watchlist').then((m) => ({ default: m.Watchlist })));
const LiveCheck = lazy(() => import('../screens/LiveCheck').then((m) => ({ default: m.LiveCheck })));
const LivePicks = lazy(() => import('../screens/LivePicks').then((m) => ({ default: m.LivePicks })));
const LivePlaylist = lazy(() => import('../screens/LivePlaylist').then((m) => ({ default: m.LivePlaylist })));
const LiveTV = lazy(() => import('../screens/LiveTV').then((m) => ({ default: m.LiveTV })));
const LiveXtream = lazy(() => import('../screens/LiveXtream').then((m) => ({ default: m.LiveXtream })));
const Player = lazy(() => import('../screens/Player').then((m) => ({ default: m.Player })));
const Plans = lazy(() => import('../screens/Plans').then((m) => ({ default: m.Plans })));
const Legal = lazy(() => import('../screens/Legal').then((m) => ({ default: m.Legal })));
const MailSettings = lazy(() => import('../screens/MailSettings').then((m) => ({ default: m.MailSettings })));
const Profiles = lazy(() => import('../screens/Profiles').then((m) => ({ default: m.Profiles })));
const RealDebrid = lazy(() => import('../screens/RealDebrid').then((m) => ({ default: m.RealDebrid })));
const Recovery = lazy(() => import('../screens/Recovery').then((m) => ({ default: m.Recovery })));
const SearchModal = lazy(() => import('../screens/SearchModal').then((m) => ({ default: m.SearchModal })));
const Service = lazy(() => import('../screens/Service').then((m) => ({ default: m.Service })));
const Settings = lazy(() => import('../screens/Settings').then((m) => ({ default: m.Settings })));
const Setup = lazy(() => import('../screens/Setup').then((m) => ({ default: m.Setup })));
const SystemInfo = lazy(() => import('../screens/SystemInfo').then((m) => ({ default: m.SystemInfo })));
const Updates = lazy(() => import('../screens/Updates').then((m) => ({ default: m.Updates })));
const Changelog = lazy(() => import('../screens/ChangelogModal').then((m) => ({ default: m.ChangelogModal })));

export interface ScreenProps {
  params: Readonly<Record<string, unknown>>;
}

export interface ScreenDefinition {
  component: ComponentType<ScreenProps>;
  defaultFocus?: string | ((params: Readonly<Record<string, unknown>>) => string | undefined);
}

const SCREENS: Readonly<Record<string, ScreenDefinition>> = {
  home: { component: Home, defaultFocus: 'hero-play' },
  library: { component: Library, defaultFocus: 'stream-search' },
  watchlist: { component: Watchlist, defaultFocus: 'watchlist' },
  live: { component: LiveTV, defaultFocus: 'host' },
  'live-xtream': { component: LiveXtream, defaultFocus: 'host' },
  'live-playlist': { component: LivePlaylist, defaultFocus: 'url' },
  'live-picks': { component: LivePicks, defaultFocus: 'query' },
  'live-check': { component: LiveCheck, defaultFocus: 'run-check' },
  accounts: { component: Accounts, defaultFocus: 'accounts-search' },
  donate: { component: Donate, defaultFocus: 'donate-continue' },
  apps: { component: Apps, defaultFocus: 'app-tvm-stream' },
  service: { component: Service, defaultFocus: 'service-back' },
  profile: { component: Account, defaultFocus: 'realdebrid' },
  profiles: { component: Profiles, defaultFocus: 'profile-pick' },
  details: { component: Details, defaultFocus: 'back' },
  settings: { component: Settings, defaultFocus: 'performance' },
  plans: { component: Plans, defaultFocus: 'plan-free' },
  legal: { component: Legal, defaultFocus: 'legal-back' },

  developer: { component: Developer, defaultFocus: 'dev-free' },
  'developer-unlock': { component: DeveloperUnlock, defaultFocus: 'dev-password' },
  'mail-settings': { component: MailSettings, defaultFocus: 'mail-host' },
  'system-info': { component: SystemInfo, defaultFocus: 'back' },
  updates: { component: Updates, defaultFocus: 'check' },
  realdebrid: { component: RealDebrid, defaultFocus: 'token' },
  setup: { component: Setup, defaultFocus: 'token' },
  recovery: { component: Recovery, defaultFocus: 'settings' },
  diagnostics: { component: DiagnosticsModal, defaultFocus: 'close' },
  confirm: { component: ConfirmModal, defaultFocus: 'confirm' },
  notice: { component: NoticeModal, defaultFocus: 'close' },
  changelog: { component: Changelog, defaultFocus: 'close' },
  search: { component: SearchModal, defaultFocus: 'query' },
  player: { component: Player, defaultFocus: 'pause' },
};

export function screenDefinition(name: string): ScreenDefinition {
  return SCREENS[name] ?? SCREENS.home ?? { component: Home, defaultFocus: 'hero-play' };
}
