import { useEffect, useRef, useState } from 'react';
import {
  currentAppVersion,
  fetchReleaseChangelog,
  filterChangesForPlatform,
  groupChangesByArea,
  markReleaseChangelogSeen,
  readSeenReleaseVersion,
  shouldShowPatchNotesPopup,
} from '../data/changelog';
import type { ChangelogRelease } from '../data/content';
import { shouldSkipIntro } from '../brand/TvmIntro';
import { fetchReleaseConfig } from '../data/releaseConfig';
import { ChangelogCornerCard } from './ChangelogCornerCard';

const PLATFORM_NAMES: Record<string, string> = { web: 'Web', desktop: 'Desktop', ios: 'iPhone', android: 'Android', windows: 'Windows', roku: 'Roku', macos: 'Mac' };

export function PatchNotesSheet({ release, onClose }: { release: ChangelogRelease; onClose: () => void }): React.JSX.Element {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'GoBack' || event.key === 'BrowserBack') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);
  const groups = groupChangesByArea(filterChangesForPlatform(release.changes));
  const issues = release.knownIssues?.filter((line) => line.trim() !== '') ?? [];
  return (
    <div className="panel-scrim patch-notes" role="dialog" aria-modal="true" aria-labelledby="patch-notes-title">
      <section className="patch-notes__sheet glass glass--sheet glass-appear">
        <div className="patch-notes__body">
          <span className="patch-notes__chip">TVM {release.version}</span>
          <h1 id="patch-notes-title" className="patch-notes__title">{release.title}</h1>
          {release.highlights.length > 0 && (
            <ul className="patch-notes__highlights">
              {release.highlights.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {groups.map(({ area, items }) => (
            <section key={area} className="patch-notes__group">
              <h2>{area}</h2>
              <ul>
                {items.map((change) => (
                  <li key={change.text}>
                    {change.text}
                    {change.platforms?.map((name) => <span key={name} className="patch-notes__tag">{PLATFORM_NAMES[name] ?? name}</span>)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {issues.length > 0 && (
            <section className="patch-notes__issues" aria-label="Known issues">
              <h2>Known issues</h2>
              <ul>{issues.map((line) => <li key={line}>{line}</li>)}</ul>
            </section>
          )}
        </div>
        <div className="patch-notes__footer">
          <button ref={button} type="button" className="tvm-button tvm-button--primary tvm-button--focused" onClick={onClose}>Got it</button>
        </div>
      </section>
    </div>
  );
}

/**
 * Release notes on first launch of a new version: a modal when the service
 * switch `patchNotesPopup` is on, the corner card otherwise (or when the
 * service is unreachable or an older engine has no /api/config).
 */
export function PatchNotesPopup(): React.JSX.Element | null {
  const version = currentAppVersion();
  const [mode, setMode] = useState<'wait' | 'card' | 'modal' | 'done'>('wait');
  const [release, setRelease] = useState<ChangelogRelease | null>(null);

  useEffect(() => {
    let active = true;
    // Automated runs (?e2e=1 or a WebDriver browser) never get a blocking modal,
    // as with the intro: it would sit over every control the tests tap.
    if (shouldSkipIntro()) { setMode('card'); return undefined; }
    void fetchReleaseConfig().then(async (config) => {
      if (!active) return;
      if (!shouldShowPatchNotesPopup(config?.flags?.patchNotesPopup, readSeenReleaseVersion(), version)) {
        setMode('card');
        return;
      }
      const payload = await fetchReleaseChangelog();
      if (!active) return;
      const newest = payload.releases[0] ?? null;
      setRelease(newest);
      setMode(newest ? 'modal' : 'card');
    }).catch(() => { if (active) setMode('card'); });
    return () => { active = false; };
  }, [version]);

  if (mode === 'card') return <ChangelogCornerCard />;
  if (mode !== 'modal' || release === null) return null;
  return <PatchNotesSheet release={release} onClose={() => { markReleaseChangelogSeen(version); setMode('done'); }} />;
}

