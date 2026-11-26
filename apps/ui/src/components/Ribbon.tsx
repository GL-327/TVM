import { useEffect, useRef, useState } from 'react';
import { isKidsProfile, peekActiveProfile, subscribeProfiles } from '../data/profiles';
import { useNavigate } from '../nav/ViewStackContext';
import { FocusButton } from './FocusButton';
import { IconProfile, IconSearch, IconSettings } from './Icons';
import { SelectionDroplet } from './SelectionDroplet';
import { useLiquidLens } from './liquidLens';
import { fetchExtrasStats } from '../data/extras';
import { uiExtraEnabled, useExtraPrefs } from '../data/uiExtras';
import { usePhoneShell } from '../nav/usePhoneShell';

type RibbonTab = 'hub' | 'home' | 'movies' | 'shows' | 'library' | 'search' | 'live' | 'apps' | 'settings' | 'profile' | 'watchlist';
const lastSelection = { left: 0, width: 0 };

export function Ribbon({ active = 'home', onLane }: {
  active?: RibbonTab; onLane?: (lane: 'all' | 'movies' | 'shows') => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const prefs = useExtraPrefs();
  // On phones, Search sits beside Settings at the top.
  const phone = usePhoneShell();
  const track = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [statsAvailable, setStatsAvailable] = useState(false);
  const statsEnabled = uiExtraEnabled('watchStats', prefs);
  useLiquidLens(sheet, { blur: 7, active: more });
  const [kids, setKids] = useState(() => isKidsProfile(peekActiveProfile()));
  useEffect(() => subscribeProfiles(() => setKids(isKidsProfile(peekActiveProfile()))), []);

  useEffect(() => {
    if (!more) return;
    const close = (): void => setMore(false);
    window.addEventListener('tvm:navigate-back', close);
    return () => window.removeEventListener('tvm:navigate-back', close);
  }, [more]);

  useEffect(() => {
    if (!more || !statsEnabled || kids) return;
    const request = new AbortController();
    void fetchExtrasStats(request.signal).then((stats) => {
      if (!request.signal.aborted) setStatsAvailable(stats !== null);
    });
    return () => request.abort();
  }, [kids, more, statsEnabled]);

  const browse = (lane: 'all' | 'movies' | 'shows'): void => {
    if (onLane) onLane(lane);
    else navigate.push('library', { params: { lane } });
  };
  const tabs = [
    ['hub-dock', 'hub', 'Hub', () => { if (active !== 'hub') navigate.home(); }],
    ['home-dock', 'home', 'Home', () => {
      if (active === 'home') return;
      if (active !== 'hub') navigate.home();
      navigate.push('home');
    }],
    ['movies', 'movies', 'Movies', () => browse('movies')],
    ['series', 'shows', 'Series', () => browse('shows')],
    ['live', 'live', 'Live TV', () => navigate.push('live')],
    ['library', 'library', 'Library', () => browse('all')],
  ] as const;
  const searchButton = (
    <FocusButton id="search" className={`${phone ? 'polish-nav__icon' : 'polish-nav__tab'} polish-nav__search ribbon-search`}
      title="Search" ariaLabel="Search" tabIndex={0} onSelect={() => navigate.pushModal('search', { params: { from: 'home' } })}>
      <IconSearch />
    </FocusButton>
  );
  const menu = [
    ['more-profiles', 'Switch profile', 'profiles'],
    ['more-profile', 'Account', 'profile'],
    ['more-library', 'TVM Library', 'library'],
    ['more-stats', 'Your stats', 'stats'],
    ['watchlist', 'My List', 'watchlist'],
    ['more-apps', 'Apps', 'apps'],
    ['more-settings', 'Settings', 'settings'],
  ] as const;

  return (
    <nav className="ribbon ribbon--open polish-nav" aria-label="TVM" data-wrap={phone ? undefined : 'row'}>
      <FocusButton id="tvm-home" className="polish-nav__brand" ariaLabel="TVM Hub" onSelect={() => navigate.home()}>
        TVM
      </FocusButton>
      <div className="ribbon__frost polish-nav__capsule">
        <div className="ribbon__list polish-nav__items" ref={track} data-wrap={phone ? 'row' : 'none'}>
          <SelectionDroplet track={track} selected={tabs.find((item) => item[1] === active)?.[0] ?? ''}
            className="polish-nav__droplet" history={lastSelection} />
          {tabs.map(([id, tab, title, select]) => (
            <FocusButton key={id} id={id} className="polish-nav__tab" ariaPressed={active === tab}
              tabIndex={0} onSelect={select}>{title}</FocusButton>
          ))}
          {!phone && searchButton}
        </div>
      </div>
      <div className="polish-nav__side" data-wrap={phone ? 'row' : 'none'}>
        {phone && searchButton}
        {!kids && <FocusButton id="settings" className="polish-nav__icon polish-nav__settings" title="Settings"
          ariaLabel="Settings" tabIndex={0} onSelect={() => navigate.push('settings')}><IconSettings /></FocusButton>}
        <FocusButton id="more" className="polish-nav__icon" title="Profile and more" ariaLabel="Profile and more"
          ariaExpanded={more} tabIndex={0} onSelect={() => setMore(!more)}>
          <span className="ribbon__avatar"><IconProfile className="ribbon__avatar-svg" /></span>
        </FocusButton>
      </div>
      {more && <>
        <button className="polish-nav__dismiss" type="button" aria-label="Close menu" onClick={() => setMore(false)} />
        <div ref={sheet} className="polish-nav__menu glass glass--sheet" aria-label="Profile and more" data-wrap="y">
          {menu.filter(([, , screen]) => (!kids || !['profile', 'settings', 'stats'].includes(screen)) &&
            (screen !== 'stats' || statsEnabled && statsAvailable)).map(([id, label, screen]) => (
            <FocusButton key={id} id={id} tabIndex={0} className="polish-nav__menu-item" onSelect={() => {
              setMore(false);
              if (screen === 'library') browse('all');
              else navigate.push(screen);
            }}>{label}</FocusButton>
          ))}
        </div>
      </>}
    </nav>
  );
}
