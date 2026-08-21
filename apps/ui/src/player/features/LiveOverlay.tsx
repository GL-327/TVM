import { useEffect } from 'react';

/**
 * Live TV and VOD share PlayerRoot. This module is the live-mode flag:
 * same chrome (back + title), channel name instead of a VOD title, no skip-recap.
 * HLS attach stays in the shared player — do not fork the stream engine here.
 */
export const LIVE_OVERLAY_MODE = true;

export const LIVE_OVERLAY_CHROME = {
  back: true,
  channelName: true,
  skipRecap: false,
} as const;

export function isLivePlayback(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith('live:');
}

export function livePlayerParams(channel: { id: string; name: string }): { id: string; title: string } {
  return { id: channel.id, title: channel.name };
}

export interface LiveOverlayPolicy {
  live: boolean;
  skipRecap: boolean;
  persistProgress: boolean;
  queue: boolean;
  ads: boolean;
}

export function liveOverlayPolicy(id: string, planSkipRecap: boolean): LiveOverlayPolicy {
  if (!isLivePlayback(id)) {
    return {
      live: false,
      skipRecap: planSkipRecap,
      persistProgress: true,
      queue: true,
      ads: true,
    };
  }
  return {
    live: true,
    skipRecap: false,
    persistProgress: false,
    queue: false,
    ads: false,
  };
}

export function liveTitleBadges(planBadges: readonly string[]): string[] {
  return ['Live', ...planBadges.filter((badge) => badge !== 'Live')];
}

export interface LiveOverlayProps {
  channelName?: string;
  badges?: readonly string[];
  title?: string;
  mediaId?: string;
  id?: string;
  live?: boolean;
}

function stampLiveMode(live: boolean): () => void {
  if (!live || typeof document === 'undefined') return () => undefined;
  const roots = document.querySelectorAll('.player, [data-player-root]');
  const previous: Array<{ el: Element; live: string | null; skip: string | null }> = [];
  roots.forEach((el) => {
    previous.push({
      el,
      live: el.getAttribute('data-live-mode'),
      skip: el.getAttribute('data-skip-recap'),
    });
    el.setAttribute('data-live-mode', 'true');
    el.setAttribute('data-skip-recap', 'false');
    el.classList.add('player--live');
  });
  return () => {
    for (const entry of previous) {
      if (entry.live === null) entry.el.removeAttribute('data-live-mode');
      else entry.el.setAttribute('data-live-mode', entry.live);
      if (entry.skip === null) entry.el.removeAttribute('data-skip-recap');
      else entry.el.setAttribute('data-skip-recap', entry.skip);
      if (entry.live !== 'true') entry.el.classList.remove('player--live');
    }
  };
}

export function LiveOverlay({
  channelName,
  badges = [],
  title,
  mediaId,
  id,
  live: liveProp,
}: LiveOverlayProps): React.JSX.Element | null {
  const playbackId = mediaId ?? id ?? '';
  const live = liveProp === true || channelName !== undefined || isLivePlayback(playbackId);
  const name = (channelName ?? title ?? '').trim();

  useEffect(() => stampLiveMode(live), [live]);

  if (!live) return null;

  const flag = <style>{LIVE_MODE_CSS}</style>;

  if (channelName !== undefined) {
    const labels = liveTitleBadges(badges);
    return (
      <p className="player__title">
        {flag}
        {name}
        <span className="player__badges">{labels.join(' · ')}</span>
      </p>
    );
  }

  return (
    <div className="player-live-flag" data-player-overlay="live" data-live-mode="true" data-skip-recap="false" hidden>
      {flag}
    </div>
  );
}

const LIVE_MODE_CSS = `
[data-live-mode="true"] [data-focus-id="skip-recap"],
[data-live-mode="true"] [data-focus-id="player-skip-recap"],
.player--live [data-focus-id="skip-recap"],
.player--live [data-focus-id="player-skip-recap"] {
  display: none !important;
}
`;

export default LiveOverlay;
