import { useEffect, useRef, useState, type WheelEvent } from 'react';
import { enterTvmStream } from '../data/profiles';
import { useNavigate } from '../nav/ViewStackContext';
import { FocusButton } from './FocusButton';
import {
  IconApps,
  IconHome,
  IconInputs,
  IconLive,
  IconProfile,
  IconSearch,
  IconSettings,
  IconWatchlist,
} from './Icons';

interface RibbonProps {
  active?: 'home' | 'library' | 'search' | 'live' | 'apps' | 'settings' | 'profile' | 'watchlist';
}

const HIDE_MS = 240;

function passWheelToPage(event: WheelEvent<HTMLElement>): void {
  const page = event.currentTarget.closest<HTMLElement>('.page, .home');
  if (page === null || event.deltaY === 0) return;
  page.scrollTop += event.deltaY;
}

export function Ribbon({ active = 'home' }: RibbonProps): React.JSX.Element {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLElement>(null);
  const hideRef = useRef(0);
  const [open, setOpen] = useState(false);

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
        className={`ribbon${open ? ' ribbon--open' : ''}`}
        aria-label="TVM"
        data-open={open ? 'true' : undefined}
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
        onWheel={passWheelToPage}
      >
        <div className="ribbon__frost">
          <div className="ribbon__list" data-wrap="row">
            <FocusButton
              id="home-dock"
              className={`ribbon__icon${active === 'home' ? ' ribbon__icon--on' : ''}`}
              onSelect={() => navigate.home()}
            >
              <span className="ribbon__glyph">
                <IconHome />
              </span>
              <span className="ribbon__label">Home</span>
            </FocusButton>
            <FocusButton
              id="search"
              className={`ribbon__icon ribbon-search${active === 'search' ? ' ribbon__icon--on' : ''}`}
              onSelect={() => navigate.pushModal('search', { params: { from: 'home' } })}
            >
              <span className="ribbon__glyph">
                <IconSearch />
              </span>
              <span className="ribbon__label">Search</span>
            </FocusButton>
            <FocusButton
              id="inputs"
              className="ribbon__icon"
              onSelect={() =>
                navigate.pushModal('notice', {
                  params: {
                    title: 'Inputs',
                    body: 'This computer outputs over HDMI. Switch the television input to this device to watch TVM.',
                  },
                })
              }
            >
              <span className="ribbon__glyph">
                <IconInputs />
              </span>
              <span className="ribbon__label">Inputs</span>
            </FocusButton>
            <FocusButton
              id="live"
              className={`ribbon__icon${active === 'live' ? ' ribbon__icon--on' : ''}`}
              onSelect={() => navigate.push('live')}
            >
              <span className="ribbon__glyph">
                <IconLive />
              </span>
              <span className="ribbon__label">Live TV</span>
            </FocusButton>
            <FocusButton
              id="watchlist"
              className={`ribbon__icon${active === 'watchlist' ? ' ribbon__icon--on' : ''}`}
              onSelect={() => navigate.push('watchlist')}
            >
              <span className="ribbon__glyph">
                <IconWatchlist />
              </span>
              <span className="ribbon__label">Watchlist</span>
            </FocusButton>
            <FocusButton
              id="library"
              className={`ribbon__icon${active === 'library' ? ' ribbon__icon--on' : ''}`}
              onSelect={() => void enterTvmStream(navigate)}
            >
              <span className="ribbon__glyph ribbon__glyph--tvm">TVM</span>
              <span className="ribbon__label">Library</span>
            </FocusButton>
            <FocusButton
              id="apps"
              className={`ribbon__icon${active === 'apps' ? ' ribbon__icon--on' : ''}`}
              onSelect={() => navigate.push('apps')}
            >
              <span className="ribbon__glyph">
                <IconApps />
              </span>
              <span className="ribbon__label">Apps</span>
            </FocusButton>
            <span className="ribbon__spacer" aria-hidden="true" />
            <FocusButton
              id="settings"
              className={`ribbon__icon${active === 'settings' ? ' ribbon__icon--on' : ''}`}
              onSelect={() => navigate.push('settings')}
            >
              <span className="ribbon__glyph">
                <IconSettings />
              </span>
              <span className="ribbon__label">Settings</span>
            </FocusButton>
            <FocusButton
              id="profile"
              className={`ribbon__icon${active === 'profile' ? ' ribbon__icon--on' : ''}`}
              onSelect={() => navigate.push('profile')}
            >
              <IconProfile className="ribbon__avatar-svg" />
              <span className="ribbon__label">Profile</span>
            </FocusButton>
          </div>
        </div>
      </nav>
    </>
  );
}
