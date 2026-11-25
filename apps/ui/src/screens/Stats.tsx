import { useCallback, useEffect, useState } from 'react';
import { Artwork } from '../components/Artwork';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import {
  fetchExtrasStats,
  formatEpisodeCode,
  formatWatchDuration,
  STATS_CLEARED_EVENT,
  type ExtrasStats,
} from '../data/extras';
import { launchTitle } from '../data/launchTitle';
import { asTitle } from '../data/media';
import { formatAppDate } from '../i18n/locale';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Stats(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [stats, setStats] = useState<ExtrasStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const next = await fetchExtrasStats();
    setStats(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const onCleared = (): void => {
      void load();
    };
    window.addEventListener(STATS_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(STATS_CLEARED_EVENT, onCleared);
  }, [load]);

  const maxGenreSeconds =
    stats !== null && stats.topGenres.length > 0
      ? Math.max(1, ...stats.topGenres.map((entry) => entry.seconds))
      : 1;

  return (
    <main className="page page--settings page--docked page--stats">
      <PageScene />
      <Ribbon active="settings" />
      <header className="page__toolbar">
        <div className="page__toolbar-lead">
          <BackButton id="stats-back" />
          <div>
            <p className="stage__kicker">Local watch data</p>
            <h1 className="page__heading">Your stats</h1>
          </div>
        </div>
        {stats !== null && (stats.history.length > 0 || stats.all > 0) && (
          <FocusButton
            id="stats-clear-history"
            className="tvm-button--glass"
            onSelect={() =>
              navigate.pushModal('confirm', {
                params: {
                  title: 'Clear watch history?',
                  body: 'Watch history and watch-time totals for this profile are removed from this device.',
                  confirmLabel: 'Clear history',
                  action: 'clear-stats-history',
                },
              })
            }
          >
            Clear history
          </FocusButton>
        )}
      </header>

      <p className="page__lede">
        Calculated locally on this device for the active profile. Watch stats are never uploaded.
      </p>

      {loading ? (
        <p className="page__lede">Loading stats…</p>
      ) : stats === null ? (
        <section className="stats-empty glass glass--card">
          <p className="page__lede">Watch stats are not available right now.</p>
        </section>
      ) : (
        <div className="stats-stack">
          <section className="stats-grid" aria-label="Watch totals">
            <article className="stats-card glass glass--card">
              <span className="stats-card__label">This week</span>
              <strong className="stats-card__value">{formatWatchDuration(stats.week)}</strong>
            </article>
            <article className="stats-card glass glass--card">
              <span className="stats-card__label">This month</span>
              <strong className="stats-card__value">{formatWatchDuration(stats.month)}</strong>
            </article>
            <article className="stats-card glass glass--card">
              <span className="stats-card__label">All time</span>
              <strong className="stats-card__value">{formatWatchDuration(stats.all)}</strong>
            </article>
            <article className="stats-card glass glass--card">
              <span className="stats-card__label">Titles finished</span>
              <strong className="stats-card__value">{stats.finished}</strong>
            </article>
            <article className="stats-card glass glass--card">
              <span className="stats-card__label">Current streak</span>
              <strong className="stats-card__value">
                {stats.streakDays} {stats.streakDays === 1 ? 'day' : 'days'}
              </strong>
            </article>
          </section>

          {stats.topGenres.length > 0 && (
            <section className="stats-panel glass glass--card" aria-label="Top genres">
              <h2 className="settings-group__title">Top genres</h2>
              <div className="stats-genres">
                {stats.topGenres.slice(0, 6).map((entry) => {
                  const pct = Math.max(8, Math.min(100, Math.round((entry.seconds / maxGenreSeconds) * 100)));
                  return (
                    <div key={entry.genre} className="stats-genre-row">
                      <div className="stats-genre-row__head">
                        <span>{entry.genre}</span>
                        <span>{formatWatchDuration(entry.seconds)}</span>
                      </div>
                      <div className="stats-genre-bar" aria-hidden="true">
                        <span className="stats-genre-bar__fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="stats-panel glass glass--card" aria-label="Watch history">
            <h2 className="settings-group__title">Watch history</h2>
            {stats.history.length === 0 ? (
              <p className="page__lede">No watch history for this profile yet.</p>
            ) : (
              <div className="stats-history" data-wrap="y">
                {stats.history.map((entry, idx) => {
                  const title = asTitle(entry.item);
                  const ep =
                    entry.item.season !== undefined && entry.item.episode !== undefined
                      ? formatEpisodeCode(entry.item.season, entry.item.episode)
                      : null;
                  const subtitle = [ep, entry.at !== '' ? formatAppDate(entry.at) : '', formatWatchDuration(entry.seconds)]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <FocusButton
                      key={`${entry.item.id}-${idx}`}
                      id={`stats-history-${idx}`}
                      className="stats-history__row"
                      detail={subtitle}
                      onSelect={() => void launchTitle(navigate, title)}
                    >
                      <span className="stats-history__lead">
                        <Artwork title={title} kind="poster" className="stats-history__thumb" />
                        <span className="stats-history__title">{title.title}</span>
                      </span>
                    </FocusButton>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
