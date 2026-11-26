import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { FocusField } from '../components/FocusField';
import { IconSearch } from '../components/Icons';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import { Switch } from '../components/Switch';
import { fetchAccount, isDevAccount } from '../data/account';
import { currentAppVersion } from '../data/changelog';
import { apiFetch, fetchRdStatus, peekHome } from '../data/media';
import { isExtraAllowed } from '../data/polishPrefs';
import { PREFS_CHANGED_EVENT, readPrefs, savePrefs, type AppPrefs } from '../data/prefs';
import { useReleaseConfig } from '../data/releaseConfig';
import { LANGUAGES } from '../i18n/locale';
import { bindKeyboardFields } from '../nav/pointerInput';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { applyTheme, readStoredTheme } from '../theme/apply';
import { applyAccent, applyFont, applyTransparency, readAccent, readFont, readTransparency } from '../theme/appearance';
import { THEMES } from '../theme/registry';
import { applyMotionPreference, applyPerformanceMode, readMotionPreference, readPerformanceMode } from '../theme/motion';
import { action, audioRows, extraRows, playbackRows, segment, select, toggle, type SettingsRow } from './settingsControls';
import './settings.css';

const CATEGORIES = [
  ['account', 'Account', 'Manage your TVM account and access.', 'person'],
  ['profiles', 'Profiles', 'Choose avatars, age limits and profile PINs.', 'people'],
  ['playback', 'Playback', 'Choose how TVM starts and plays your videos.', 'play'],
  ['audio', 'Audio & subtitles', 'Set your preferred captions and sound.', 'audio'],
  ['appearance', 'Appearance', 'Adjust the interface for this device.', 'appearance'],
  ['home', 'Home screen', 'Choose what appears on Home and in what order.', 'home'],
  ['extras', 'Extras', 'Choose which playback and discovery features to use.', 'extras'],
  ['live', 'Live TV', 'Manage your channel sources and favourites.', 'live'],
  ['rd', 'Real-Debrid', 'Connect your Real-Debrid account for playback.', 'link'],
  ['downloads', 'Downloads', 'View and manage videos saved on this device.', 'download'],
  ['updates', 'Updates', 'Check for the latest version of TVM.', 'update'],
  ['stats', 'Your stats', 'See what you have watched and how much time you spent watching.', 'stats'],
  ['about', 'About', 'Find release notes, device details and support tools.', 'about'],
  ['developer', 'Developer', 'Manage account services and diagnose this install.', 'code'],
] as const;
type Category = typeof CATEGORIES[number][0];
const paths: Record<string, ReactNode> = {
  person: <><circle cx="12" cy="8" r="3.4"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/></>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/></>,
  play: <path d="M8 5v14l11-7Z"/>,
  audio: <path d="M4 9h4l5-4v14l-5-4H4Zm13 0a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>,
  appearance: <><circle cx="12" cy="12" r="8"/><path d="M12 4v16m0-14 4 4m-4 1 6 6m-6-1 2 2"/></>,
  home: <path d="m3 11 9-7 9 7m-2-1v10h-5v-6h-4v6H5V10"/>,
  extras: <path d="M5 6h14M5 12h14M5 18h14M9 4v4m6 2v4m-5 2v4"/>,
  live: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 21h6m-3-3v3"/></>,
  link: <path d="m10 14 4-4m-5 6-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2-2 2-2a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/>,
  download: <path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>,
  update: <path d="M20 8a8 8 0 1 0 0 8m0-13v5h-5"/>,
  stats: <path d="M5 19v-5m5 5V9m5 10V5m5 14V8"/>,
  about: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
  code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>,
};

function SettingsIcon({ name }: { name: string }): React.JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function useCompactSettings(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = (): void => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

export function Settings({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const page = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  const compact = useCompactSettings();
  const pushed = CATEGORIES.find(([id]) => params.category === id)?.[0];
  const [category, setCategory] = useState<Category>(pushed ?? 'account');
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = useState(readPrefs);
  const [theme, setTheme] = useState(readStoredTheme);
  const [accent, setAccent] = useState(readAccent);
  const [font, setFont] = useState(readFont);
  const [transparency, setTransparency] = useState(readTransparency);
  const [motion, setMotion] = useState(() => readMotionPreference() === 'reduced');
  const [performance, setPerformance] = useState(readPerformanceMode);
  const [admin, setAdmin] = useState(false);
  const [rd, setRd] = useState('Connect or manage your key');
  const [stats, setStats] = useState(true);
  useReleaseConfig();

  useEffect(() => {
    void fetchAccount().then((state) => setAdmin(isDevAccount(state))).catch(() => undefined);
    void fetchRdStatus().then((status) => setRd(status?.configured ? status.username ?? 'Connected' : 'Connect your account'));
    void apiFetch('/api/extras/stats').then((response) => setStats(response.status !== 404)).catch(() => undefined);
    const update = (): void => setPrefs(readPrefs());
    window.addEventListener(PREFS_CHANGED_EVENT, update);
    return () => window.removeEventListener(PREFS_CHANGED_EVENT, update);
  }, []);
  useEffect(() => bindKeyboardFields(page.current), []);
  // The page is the scroller on desktop (the sidebar is sticky), so a new category
  // must reset it too or its title stays hidden under the nav.
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
    if (page.current) page.current.scrollTop = 0;
  }, [category, query]);

  const save = (patch: Partial<AppPrefs>): void => { void savePrefs(patch).then(setPrefs); };
  const jump = (screen: string): (() => void) => () => navigate.push(screen);
  const display = CATEGORIES.filter(([id]) => id !== 'developer' || admin)
    .filter(([id]) => id !== 'stats' || stats && isExtraAllowed('watchStats') && prefs.extras.watchStats !== false);
  const active = display.find(([id]) => id === category) ?? CATEGORIES[0];
  const sections = [
    ['continue', 'Continue watching'], ['my-list', 'My List'], ['upcoming', 'New episodes this week'], ['automatic', 'Automatic collections'],
    ...(peekHome()?.rails ?? []).map((rail) => [rail.id, rail.title]),
  ];
  const sectionNames = new Map(sections.map(([id, label]) => [id!, label!]));
  const homeSections = [...prefs.homeSections.filter(({ id }) => sectionNames.has(id)),
    ...Array.from(sectionNames.keys()).filter((id) => !prefs.homeSections.some((section) => section.id === id)).map((id) => ({ id, visible: true }))];

  const rows: Record<Category, SettingsRow[]> = {
    account: [
      action('account', 'Your account', 'Sign-in, access and account details.', jump('profile')),
      action('plan', 'Plan', 'View your TVM access and available plans.', jump('plans')),
      action('streaming-services', 'Streaming services', 'Connect your external streaming services.', jump('your-services')),
      action('privacy', 'Privacy & terms', 'Terms, data export and account deletion.', jump('legal')),
    ],
    profiles: [action('profiles', 'Manage profiles', 'Add or edit a profile, or switch who is watching.', jump('profiles'))],
    playback: playbackRows(prefs, save),
    audio: audioRows(prefs, save),
    appearance: [
      select('font', 'Font', 'Choose the typeface for menus and labels.', font,
        [{ id: 'geist', label: 'Geist' }, { id: 'inter', label: 'Inter' }, { id: 'system', label: 'System' }],
        (value) => { applyFont(value); setFont(value); }),
      segment('theme', 'Theme', 'Choose your interface colours.', theme, THEMES.map(({ id, name }) => ({ id, label: name })),
        (value) => setTheme(applyTheme(value))),
      ...(theme === 'dark' ? [select('accent', 'Accent colour', 'Highlight colour for active controls.', accent,
        [
          { id: 'default', label: 'Ice blue' },
          { id: 'indigo', label: 'Indigo' },
          { id: 'coral', label: 'Coral' },
          { id: 'amber', label: 'Amber' },
          { id: 'emerald', label: 'Emerald' },
        ], (value) => setAccent(applyAccent(value)))] : []),
      toggle('reduce-transparency', 'Reduce transparency', 'Use solid backgrounds on glass controls.', transparency,
        (value) => { applyTransparency(value); setTransparency(value); }),
      toggle('motion', 'Reduce motion', 'Use fades and pause decorative animation.', motion,
        (value) => { applyMotionPreference(value ? 'reduced' : 'auto'); setMotion(value); }),
      toggle('poster-titles', 'Poster titles', 'Show names below artwork.', prefs.posterTitles, (posterTitles) => save({ posterTitles })),
      toggle('performance', 'Performance mode', 'Simplify effects on slower devices.', performance,
        (value) => setPerformance(applyPerformanceMode(value))),
      select('language', 'App language', 'Change the language used by TVM.', prefs.language,
        LANGUAGES.map(({ id, name }) => ({ id, label: name })), (language) => save({ language })),
    ],
    home: [
      ...(/TVM-iOS|TVM-Android/.test(navigator.userAgent) ? [] : [
        toggle('hero-previews', 'Hero previews', 'Play a muted clip when one is available.', prefs.heroPreviews, (heroPreviews) => save({ heroPreviews })),
      ]),
      toggle('spotlight-events', 'Spotlight events', 'Feature film and TV releases at the top of Home.', prefs.spotlightEvents, (spotlightEvents) => save({ spotlightEvents })),
      ...homeSections.map((item, index) => ({
        id: 'home-row-' + item.id, title: sectionNames.get(item.id) ?? item.id, detail: 'Home row',
        control: <div className="settings-order">
          {[-1, 1].map((step) => <button type="button" key={step} disabled={homeSections[index + step] === undefined}
            aria-label={(step < 0 ? 'Move up ' : 'Move down ') + sectionNames.get(item.id)} onClick={() => {
              const next = [...homeSections];
              [next[index], next[index + step]] = [next[index + step]!, item];
              save({ homeSections: next });
            }}>{step < 0 ? '↑' : '↓'}</button>)}
          <Switch id={'home-show-' + item.id} label={'Show ' + sectionNames.get(item.id)} checked={item.visible}
            onChange={(visible) => save({ homeSections: homeSections.map((section) => section === item ? { ...section, visible } : section) })} />
        </div>,
      })),
    ],
    extras: extraRows(prefs, save),
    live: [
      action('guide', 'Programme guide', 'Browse free channels and your own sources.', jump('live')),
      action('live-playlist', 'M3U playlist', 'Add a playlist URL or paste playlist text.', jump('live-playlist')),
      action('livetv', 'Xtream login', 'Sign in with your Live TV provider.', jump('live-xtream')),
      action('live-picks', 'Choose channels', 'Manage the channels shown from your playlist.', jump('live-picks')),
    ],
    rd: [action('realdebrid', 'Real-Debrid account', 'Manage the key for your own subscription.', jump('realdebrid'), rd)],
    downloads: [action('downloads', 'Saved videos', 'View download progress and manage offline videos.', () => navigate.pushModal('downloads'))],
    updates: [
      action('updates', 'Check for updates', 'View the installed version and available updates.', jump('updates')),
      toggle('auto-update', 'Automatic updates', 'Check for and apply updates when TVM opens.', prefs.autoUpdate, (autoUpdate) => save({ autoUpdate })),
      action('roku-updates', 'Roku updates', 'Install TVM updates on your Roku.', jump('roku-updates')),
    ],
    stats: [action('your-stats', 'Watch history & stats', 'Review watch time, genres and recent titles.', jump('stats'))],
    about: [
      action('whats-new', "What's new", 'Read the release notes.', jump('whats-new'), currentAppVersion()),
      action('network', 'Network', 'Connection details for this device.', () => navigate.push('system-info', { params: { section: 'network' } })),
      action('display', 'Display', 'Device resolution and playback limits.', () => navigate.push('system-info', { params: { section: 'display' } })),
      action('diagnostics', 'Diagnostics', 'Inspect the running Core.', () => navigate.pushModal('diagnostics')),
      action('clear-cache', 'Clear cache', 'Remove cached artwork and catalogues.', () => navigate.pushModal('confirm', { params: {
        title: 'Clear cache?', body: 'Cached artwork and catalogues will be downloaded again when needed.', confirmLabel: 'Clear cache', action: 'clear-cache',
      } })),
      action('restart', 'Restart TVM', 'Reload the interface.', () => navigate.pushModal('confirm', { params: {
        title: 'Restart TVM?', body: 'Reload the interface on this device.', confirmLabel: 'Restart', action: 'restart',
      } })),
      action('factory-reset', 'Fully reset', 'Remove local TVM data from this device.', () => navigate.pushModal('confirm', { params: {
        title: 'Fully reset TVM?', body: 'This removes local profiles, progress, My List, playlists, caches and your saved Real-Debrid key.', confirmLabel: 'Fully reset', action: 'factory-reset',
      } })),
    ],
    developer: admin ? [action('developer', 'Developer menu', 'Accounts, announcements, flags and diagnostics.', jump('developer'))] : [],
  };
  const term = query.trim().toLowerCase();
  const results = term ? display.map(([id, name]) => ({ id, name, rows: rows[id].filter(({ title, detail }) =>
    (name + ' ' + title + ' ' + detail).toLowerCase().includes(term)) })).filter(({ rows }) => rows.length) : [];
  const renderGroup = (items: SettingsRow[], label?: string): React.JSX.Element => <section className="settings-group" aria-label={label ?? active[1]}>
    {label && <h2 className="settings-group__title">{label}</h2>}
    {items.map((row) => <div className="settings-item" key={row.id}>
      <div className="settings-item__label"><strong>{row.title}</strong><p>{row.detail}</p></div>
      <div className="settings-item__control">{row.control}</div>
    </div>)}
  </section>;

  return (
    <main ref={page} className="page page--settings page--docked polish-settings" data-keyboard-fields="">
      <PageScene />
      <Ribbon active="settings" />
      <div className="settings-layout" data-category={pushed ? 'open' : 'index'} data-search={term ? 'active' : undefined}>
        <aside className="settings-sidebar" aria-label="Settings categories">
          <div className="settings-sidebar__title"><BackButton id="settings-back" /><h2>Settings</h2></div>
          <div className="settings-search"><IconSearch /><FocusField id="settings-search" type="search" value={query}
            onChange={setQuery} placeholder="Search settings" ariaLabel="Search settings" /></div>
          <div className="settings-categories" data-wrap="y">
            {display.map(([id, name, , icon]) => <FocusButton key={id} id={'settings-category-' + id} tabIndex={0}
              className="settings-category" ariaPressed={id === active[0]} onSelect={() => {
                setQuery('');
                if (compact) navigate.push('settings', { params: { category: id } });
                else setCategory(id);
              }}>
              <SettingsIcon name={icon} /><span>{name}</span><span className="settings-category__chevron" aria-hidden="true">›</span>
            </FocusButton>)}
          </div>
        </aside>
        <section ref={panel} className="settings-panel settings-list" data-wrap="y">
          <header className="settings-panel__header">
            {pushed && <BackButton id="settings-category-back" />}
            <div><h1>{term ? 'Search results' : active[1]}</h1><p>{term ? 'Settings matching your search.' : active[2]}</p></div>
          </header>
          {term ? results.length ? results.map((result) => <div key={result.id}>{renderGroup(result.rows, result.name)}</div>)
            : <p className="settings-empty">No settings match “{query.trim()}”.</p>
            : renderGroup(rows[active[0]])}
        </section>
      </div>
    </main>
  );
}
