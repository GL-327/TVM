import type { ReactNode } from 'react';
import './player-chrome.css';

export interface ChromeFrameProps {
  visible?: boolean;
  className?: string;
  top?: ReactNode;
  rail?: ReactNode;
  bottom?: ReactNode;
  children?: ReactNode;
}

function frameClass(visible: boolean, className?: string): string {
  return [
    'chrome-frame',
    'player-chrome',
    visible ? undefined : 'chrome-frame--hidden',
    visible ? undefined : 'player-chrome--hidden',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Letterbox + safe-area shell. No playback math — only layout, veils, and
 * the data attributes IdleChrome / TitleOverlay already watch.
 */
export function ChromeFrame({
  visible = true,
  className,
  top,
  rail,
  bottom,
  children,
}: ChromeFrameProps): React.JSX.Element {
  const shown = visible;
  const hasSlots = top != null || rail != null || bottom != null || children != null;

  return (
    <div
      className={frameClass(shown, className)}
      data-player-chrome=""
      data-chrome={shown ? 'visible' : 'hidden'}
      data-chrome-hidden={shown ? 'false' : 'true'}
      data-chrome-visible={shown ? 'true' : 'false'}
      aria-hidden={shown ? undefined : true}
    >
      <div className="chrome-frame__veil chrome-frame__veil--top" aria-hidden="true" />
      <div className="chrome-frame__veil chrome-frame__veil--bottom" aria-hidden="true" />
      {hasSlots ? (
        <div className="chrome-frame__safe">
          {top != null ? (
            <div className="chrome-frame__top" data-wrap="x">
              {top}
            </div>
          ) : null}
          {rail != null || children != null ? (
            <div className="chrome-frame__rail">
              {rail}
              {children}
            </div>
          ) : null}
          {bottom != null ? (
            <div className="chrome-frame__bottom" data-wrap="x">
              {bottom}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ChromeFrame;
