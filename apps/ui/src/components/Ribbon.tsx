import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react';
import { enterTvmStream } from '../data/profiles';
import { useNavigate } from '../nav/ViewStackContext';
import { usePhoneShell } from '../nav/usePhoneShell';
import { FocusButton } from './FocusButton';
import {
  IconApps,
  IconHome,
  IconInputs,
  IconLive,
  IconProfile,
  IconSearch,
  IconSettings,
  IconStream,
  IconWatchlist,
} from './Icons';

type RibbonTab = 'home' | 'library' | 'search' | 'live' | 'apps' | 'settings' | 'profile' | 'watchlist';

interface RibbonProps {
  active?: RibbonTab;
}

const HIDE_MS = 240;

/** Destinations a phone keeps on the bar. The rest live behind More. */
const PHONE_PRIMARY: readonly RibbonTab[] = ['home', 'search', 'live', 'watchlist'];

function passWheelToPage(event: WheelEvent<HTMLElement>): void {
  const page = event.currentTarget.closest<HTMLElement>('.page, .home');
  if (page === null || event.deltaY === 0) return;
  page.scrollTop += event.deltaY;
}

/**
 * One bar, two shapes.
 *
 * On a television this is a hover/focus peek at the top of a 1920px stage: it
 * holds every destination at once because a D-pad crosses nine icons as
 * cheaply as five, and because nothing is competing for the space.
 *
 * A phone is the other way round. Nine destinations wrapped onto two rows and
 * took about a sixth of the screen, which is a keyboard, not a tab bar. So the
 * phone gets the platform's own shape — four destinations and a More tab
 * that opens the rest as a sheet. The same screens are reachable either way;
 * what changes is how many of them are on the glass at once.
 *
 * HDMI Inputs is dropped on a phone rather than moved into the sheet. It tells
 * you to switch your television's input, which is not a thing a phone can do.
 */
export function Ribbon({ active = 'home' }: RibbonProps): React.JSX.Element {
  const navigate = useNavigate();
  const phone = usePhoneShell();
  const rootRef = useRef<HTMLElement>(null);
  const hideRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);

  const show = (): void => {
    window.clearTimeout(hideRef.current);
    setOpen(true);
  };

  const scheduleHide = (): void => {
    window.clearTimeout(hideRef.current);
    hideRef.current = window.setTimeout(() => {
      const root = rootRef.current;
      if (root?.contains(document.activeElement) === true || root?.querySelector('[data-focused="true"]') !== null) {
        setOpen(true);
        return;
      }
      setOpen(false);
    }, HIDE_MS);
  };

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    const onFocusIn = (): void => show();
    const onFocusOut = (): void => scheduleHide();
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      window.clearTimeout(hideRef.current);
    };
  }, []);

  // A sheet that outlives the bar it belongs to would sit over the next screen.
  useEffect(() => { setMore(false); }, [active, phone]);

  useEffect(() => {
    if (!more) return undefined;
    const onBack = (): void => setMore(false);
    window.addEventListener('tvm:navigate-back', onBack);
    return () => window.removeEventListener('tvm:navigate-back', onBack);
  }, [more]);

  const go = (run: () => void) => (): void => {
    setMore(false);
    run();
  };

  const openLibrary = go(() => { void enterTvmStream(navigate); });
  const openApps = go(() => navigate.push('apps'));
  const openSettings = go(() => navigate.push('settings'));
  const openProfile = go(() => navigate.push('profile'));

  const tab = (
    id: string,
    label: string,
    glyph: ReactNode,
    on: boolean,
    onSelect: () => void,
    extra = '',
  ): React.JSX.Element => (
    <FocusButton
      id={id}
      className={`ribbon__icon${on ? ' ribbon__icon--on' : ''}${extra === '' ? '' : ` ${extra}`}`}
      onSelect={onSelect}
    >
      <span className="ribbon__glyph">{glyph}</span>
      <span className="ribbon__label">{label}</span>
    </FocusButton>
  );

  const phoneBar = (
    <div className="ribbon__list ribbon__list--tabs" data-wrap="row">
      {tab('home-dock', 'Home', <IconHome />, active === 'home', go(() => navigate.home()))}
      {tab(
        'search',
        'Search',
        <IconSearch />,
        active === 'search',
        go(() => navigate.pushModal('search', { params: { from: 'home' } })),
        'ribbon-search',
      )}
      {tab('live', 'Live TV', <IconLive />, active === 'live', go(() => navigate.push('live')))}
      {tab('watchlist', 'Watchlist', <IconWatchlist />, active === 'watchlist', go(() => navigate.push('watchlist')))}
      <FocusButton
        id="more"
        className={`ribbon__icon ribbon__icon--more${more || !PHONE_PRIMARY.includes(active) ? ' ribbon__icon--on' : ''}`}
        onSelect={() => setMore((value) => !value)}
      >
        <span className="ribbon__avatar">
          <IconProfile className="ribbon__avatar-svg" />
        </span>
        <span className="ribbon__label">More</span>
      </FocusButton>
    </div>
  );

  const moreSheet = (
    <>
      <button
        type="button"
        className="ribbon-sheet__scrim"
        aria-label="Close"
        tabIndex={-1}
        onClick={() => setMore(false)}
      />
      <div className="ribbon-sheet" role="menu" aria-label="More">
        <span className="ribbon-sheet__grip" aria-hidden="true" />
        <FocusButton
          id="more-profile"
          className={`ribbon-sheet__row${active === 'profile' ? ' ribbon-sheet__row--on' : ''}`}
          onSelect={openProfile}
        >
          <span className="ribbon-sheet__glyph"><IconProfile /></span>
          <span className="ribbon-sheet__text">
            <strong>Account</strong>
            <span>Who is signed in, your access, and signing out</span>
          </span>
        </FocusButton>
        <FocusButton
          id="more-library"
          className={`ribbon-sheet__row${active === 'library' ? ' ribbon-sheet__row--on' : ''}`}
          onSelect={openLibrary}
        >
          <span className="ribbon-sheet__glyph"><IconStream /></span>
          <span className="ribbon-sheet__text">
            <strong>TVM Library</strong>
            <span>Films and series</span>
          </span>
        </FocusButton>
        <FocusButton
          id="more-apps"
          className={`ribbon-sheet__row${active === 'apps' ? ' ribbon-sheet__row--on' : ''}`}
          onSelect={openApps}
        >
          <span className="ribbon-sheet__glyph"><IconApps /></span>
          <span className="ribbon-sheet__text">
            <strong>Apps</strong>
            <span>Studios and services</span>
          </span>
        </FocusButton>
        <FocusButton
          id="more-settings"
          className={`ribbon-sheet__row${active === 'settings' ? ' ribbon-sheet__row--on' : ''}`}
          onSelect={openSettings}
        >
          <span className="ribbon-sheet__glyph"><IconSettings /></span>
          <span className="ribbon-sheet__text">
            <strong>Settings</strong>
            <span>Picture, sound, account and updates</span>
          </span>
        </FocusButton>
      </div>
    </>
  );

  const tvList = (
    <div className="ribbon__list" data-wrap="row">
      {tab('home-dock', 'Home', <IconHome />, active === 'home', () => navigate.home())}
      {tab(
        'search',
        'Search',
        <IconSearch />,
        active === 'search',
        () => navigate.pushModal('search', { params: { from: 'home' } }),
        'ribbon-search',
      )}
      {tab('inputs', 'Inputs', <IconInputs />, false, () =>
        navigate.pushModal('notice', {
          params: {
            title: 'Inputs',
            body: 'This computer outputs over HDMI. Switch the television input to this device to watch TVM.',
          },
        }),
      )}
      {tab('live', 'Live TV', <IconLive />, active === 'live', () => navigate.push('live'))}
      {tab('watchlist', 'Watchlist', <IconWatchlist />, active === 'watchlist', () => navigate.push('watchlist'))}
      <FocusButton
        id="library"
        className={`ribbon__icon${active === 'library' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => void enterTvmStream(navigate)}
      >
        <span className="ribbon__glyph ribbon__glyph--tvm">TVM</span>
        <span className="ribbon__label">Library</span>
      </FocusButton>
      {tab('apps', 'Apps', <IconApps />, active === 'apps', () => navigate.push('apps'))}
      <span className="ribbon__spacer" aria-hidden="true" />
      {tab('settings', 'Settings', <IconSettings />, active === 'settings', () => navigate.push('settings'))}
      <FocusButton
        id="profile"
        className={`ribbon__icon${active === 'profile' ? ' ribbon__icon--on' : ''}`}
        onSelect={() => navigate.push('profile')}
      >
        <span className="ribbon__avatar">
          <IconProfile className="ribbon__avatar-svg" />
        </span>
        <span className="ribbon__label">Account</span>
      </FocusButton>
    </div>
  );

  return (
    <>
      <div
        className="ribbon-zone"
        aria-hidden="true"
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
        onWheel={passWheelToPage}
      />
      <nav
        ref={rootRef}
        className={`ribbon${open ? ' ribbon--open' : ''}${phone ? ' ribbon--tabs' : ''}${more ? ' ribbon--more' : ''}`}
        aria-label="TVM"
        data-open={open ? 'true' : undefined}
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
        onWheel={passWheelToPage}
      >
        {phone && more ? moreSheet : null}
        <div className="ribbon__frost">{phone ? phoneBar : tvList}</div>
      </nav>
    </>
  );
}
