import { useEffect, useState } from 'react';
import { formatDrift, isBehindLive } from '../liveEdge';

/**
 * "Back to live" after a pause.
 *
 * Pausing live television does not pause the broadcast — it keeps arriving and
 * the player keeps buffering, so pressing play resumes from where you stopped
 * and you carry that gap for the rest of the channel. Nothing in the player
 * could previously express this, let alone undo it: seekTo refuses on a live
 * stream by design.
 *
 * The button only appears once the gap is large enough to be worth correcting.
 * A live stream always trails its own edge by a second or two, and a control
 * that sat there permanently during untouched playback would read as a fault
 * rather than an offer.
 */

export interface GoLiveProps {
  /** False for VOD, where none of this applies. */
  live: boolean;
  /** Seconds behind the broadcast, polled from the engine. */
  drift: number;
  onGoLive: () => void;
  /** Hidden along with the rest of the chrome when the player goes idle. */
  visible?: boolean;
}

export function GoLive({ live, drift, onGoLive, visible = true }: GoLiveProps): React.JSX.Element | null {
  if (!live || !isBehindLive(drift)) return null;
  return (
    <button
      type="button"
      className="player__go-live"
      data-focus-id="go-live"
      data-player-overlay="go-live"
      data-hidden={visible ? undefined : 'true'}
      onClick={onGoLive}
    >
      <span className="player__go-live-dot" aria-hidden="true" />
      <span className="player__go-live-label">Back to live</span>
      <span className="player__go-live-drift">{formatDrift(drift)}</span>
    </button>
  );
}

/**
 * Polls the engine for how far behind the broadcast we are.
 *
 * Polled rather than event-driven because neither transport emits anything
 * when the gap opens: it grows silently while the stream is paused, and the
 * buffer edge advances on its own schedule. Two seconds is frequent enough to
 * catch a pause and far too slow to cost anything.
 */
export function useLiveDrift(
  live: boolean,
  read: () => number,
  intervalMs = 2000,
): number {
  const [drift, setDrift] = useState(0);
  useEffect(() => {
    if (!live) {
      setDrift(0);
      return;
    }
    const tick = (): void => {
      const value = read();
      setDrift((current) => (Math.abs(current - value) < 1 ? current : value));
    };
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
    // `read` is a stable engine accessor; re-subscribing on every render would
    // restart the interval continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, intervalMs]);
  return drift;
}

export const GO_LIVE_CSS = `
.player__go-live {
  position: absolute;
  top: clamp(1rem, 4vh, 2.5rem);
  right: clamp(1rem, 4vw, 3rem);
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 1rem;
  border: 1px solid rgb(255 255 255 / 22%);
  border-radius: 999px;
  background: rgb(12 12 16 / 72%);
  color: #fff;
  font: inherit;
  font-size: 0.95rem;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: opacity 180ms ease, transform 180ms ease, background 180ms ease;
}

.player__go-live:hover,
.player__go-live:focus-visible,
.player__go-live[data-focused='true'] {
  background: rgb(24 24 32 / 92%);
  border-color: rgb(255 255 255 / 45%);
  outline: none;
  transform: translateY(-1px);
}

.player__go-live[data-hidden='true'] {
  opacity: 0;
  pointer-events: none;
}

.player__go-live-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #ff3b30;
  box-shadow: 0 0 0 0 rgb(255 59 48 / 60%);
  animation: tvm-go-live-pulse 2s ease-out infinite;
}

.player__go-live-drift {
  opacity: 0.65;
  font-size: 0.85em;
}

@keyframes tvm-go-live-pulse {
  70% { box-shadow: 0 0 0 0.5rem rgb(255 59 48 / 0%); }
  100% { box-shadow: 0 0 0 0 rgb(255 59 48 / 0%); }
}
`;

export default GoLive;
