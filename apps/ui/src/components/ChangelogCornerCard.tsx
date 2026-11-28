import { useEffect, useState } from 'react';
import {
  cornerCardLines,
  currentAppVersion,
  fetchReleaseChangelog,
  markReleaseChangelogSeen,
  readSeenReleaseVersion,
  shortReleaseLabel,
  shouldShowReleaseCornerCard,
} from '../data/changelog';
import type { ChangelogRelease } from '../data/content';
import { useNavigate } from '../nav/ViewStackContext';

const GRACE_MS = 1200;

/**
 * Unobtrusive glass corner card shown once on Home after the installed version
 * changes. Never steals focus or blocks page interaction; dismisses cleanly on
 * any input, scroll, focus move, playback, or resize after a 1.2s grace window.
 */
export function ChangelogCornerCard(): React.JSX.Element | null {
  const navigate = useNavigate();
  const currentVersion = currentAppVersion();
  const [release, setRelease] = useState<ChangelogRelease | null>(null);
  const lines = release === null ? null : cornerCardLines(release);
  const [dismissed, setDismissed] = useState(() => !shouldShowReleaseCornerCard(readSeenReleaseVersion(), currentVersion));

  useEffect(() => {
    if (dismissed) return undefined;
    let cancelled = false;
    void fetchReleaseChangelog().then((payload) => {
      if (cancelled) return;
      const match = payload.releases.find((r) => r.version === currentVersion) ?? payload.releases[0] ?? null;
      // Nothing in this release for this app (for example a Windows-only update): no card, and it counts as seen.
      if (match !== null && cornerCardLines(match) === null) {
        markReleaseChangelogSeen(currentVersion);
        setDismissed(true);
        return;
      }
      setRelease(match);
    });
    return () => {
      cancelled = true;
    };
  }, [currentVersion, dismissed]);

  useEffect(() => {
    if (dismissed || release === null || typeof window === 'undefined') return undefined;
    const shownAt = performance.now();

    const dismissIfReady = (event?: Event): void => {
      if (performance.now() - shownAt < GRACE_MS) return;
      if (event?.target instanceof Element && event.target.closest('.changelog-card') !== null) return;
      markReleaseChangelogSeen(currentVersion);
      setDismissed(true);
    };

    const listeners: Array<[EventTarget, string, AddEventListenerOptions | boolean]> = [
      [window, 'keydown', { capture: true }],
      [window, 'pointerdown', { capture: true }],
      [window, 'resize', { passive: true }],
      [window, 'tvm:user-activity', {}],
      [document, 'scroll', { capture: true, passive: true }],
      [document, 'focusin', { capture: true }],
    ];

    for (const [target, name, opts] of listeners) {
      target.addEventListener(name, dismissIfReady as EventListener, opts);
    }
    return () => {
      for (const [target, name, opts] of listeners) {
        target.removeEventListener(name, dismissIfReady as EventListener, opts);
      }
    };
  }, [currentVersion, dismissed, release]);

  if (dismissed || release === null || lines === null) return null;

  return (
    <aside
      className="changelog-card glass glass--sheet glass-appear"
      aria-label={`Updated to ${shortReleaseLabel(currentVersion)}`}
    >
      <div className="changelog-card__head">
        <span className="stage__kicker">Updated to {shortReleaseLabel(currentVersion)}</span>
      </div>
      <h2 className="changelog-card__title">{release.title}</h2>
      {lines.length > 0 && (
        <ul className="changelog-card__list">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="changelog-card__actions">
        <button
          type="button"
          className="changelog-card__all tvm-button tvm-button--glass"
          onClick={() => {
            markReleaseChangelogSeen(currentVersion);
            setDismissed(true);
            navigate.push('whats-new');
          }}
        >
          All changes
        </button>
      </div>
    </aside>
  );
}
