import { useEffect, useState } from 'react';
import { BackButton } from '../components/BackButton';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import {
  detectRuntimePlatform,
  fetchReleaseChangelog,
  filterChangesForPlatform,
  groupChangesByArea,
  shortReleaseLabel,
} from '../data/changelog';
import type { ChangelogRelease } from '../data/content';
import type { ScreenProps } from '../nav/registry';

export function WhatsNew(_props: ScreenProps): React.JSX.Element {
  const [releases, setReleases] = useState<ChangelogRelease[]>([]);
  const platform = detectRuntimePlatform();

  useEffect(() => {
    let cancelled = false;
    void fetchReleaseChangelog().then((data) => {
      if (!cancelled) setReleases(data.releases);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page page--settings page--docked page--whats-new">
      <PageScene />
      <Ribbon active="settings" />
      <header className="page__toolbar">
        <div className="page__toolbar-lead">
          <BackButton id="whats-new-back" />
          <div>
            <p className="stage__kicker">Release notes</p>
            <h1 className="page__heading">What's new</h1>
          </div>
        </div>
      </header>

      <div className="whats-new-list">
        {releases.map((release) => {
          const filtered = filterChangesForPlatform(release.changes, platform);
          const grouped = groupChangesByArea(filtered);
          return (
            <section key={release.version} className="whats-new-release glass glass--card">
              <header className="whats-new-release__head">
                <div>
                  <span className="stage__kicker">Version {shortReleaseLabel(release.version)}</span>
                  <h2 className="whats-new-release__title">{release.title}</h2>
                </div>
                <span className="whats-new-release__date">{release.date}</span>
              </header>

              {release.highlights.length > 0 && (
                <ul className="whats-new-release__highlights">
                  {release.highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}

              <div className="whats-new-areas">
                {grouped.map((group) => (
                  <div key={group.area} className="whats-new-area">
                    <h3 className="whats-new-area__title">{group.area}</h3>
                    <ul className="whats-new-area__list">
                      {group.items.map((item) => (
                        <li key={`${group.area}-${item.text}`}>{item.text}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
