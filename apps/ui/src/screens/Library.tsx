import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrandLockup } from '../components/BrandLockup';
import { FocusButton } from '../components/FocusButton';
import { HeroArt } from '../components/HeroArt';
import { fieldValue, FocusField } from '../components/FocusField';
import { LoadingScreen } from '../components/LoadingScreen';
import { introPlayedThisSession, shouldSkipIntro, TvmIntro } from '../brand/TvmIntro';
import { mapRailPosters } from '../components/PosterCard';
import { Rail } from '../components/Rail';
import { StreamChrome } from '../components/StreamChrome';
import { preferBackdrop } from '../data/artwork';
import { type Title } from '../data/catalog';
import {
  asTitle,
  fetchHome,
  peekHome,
  saveRdToken,
  type CatalogRail,
  type RdStatus,
} from '../data/media';
import { openDetails } from '../data/openDetails';
import { applyPlanClass, FALLBACK_PLAN, fetchPlan, type PlanStatus } from '../data/plan';
import { fetchProfiles, type Profile } from '../data/profiles';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const RD_EMPTY: RdStatus = { configured: false, username: null, premium: false, error: null };

function inLane(title: Title, lane: 'all' | 'shows' | 'movies'): boolean {
  if (lane === 'all') return true;
  if (lane === 'shows') return title.kind === 'series';
  return title.kind !== 'series';
}

export function Library(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const cached = peekHome();
  const [watching, setWatching] = useState<Title[]>(() => (cached?.continueWatching ?? []).map(asTitle));
  const [watchlist, setWatchlist] = useState<Title[]>(() => (cached?.watchlist ?? []).map(asTitle));
  const [rails, setRails] = useState<CatalogRail[]>(cached?.rails ?? []);
  const [featured, setFeatured] = useState<Title | null>(() =>
    cached?.featured !== null && cached?.featured !== undefined ? asTitle(cached.featured) : null,
  );
  const [rd, setRd] = useState<RdStatus>(cached?.rd ?? RD_EMPTY);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lane, setLane] = useState<'all' | 'shows' | 'movies'>('all');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);
  const [loading, setLoading] = useState(cached === null);
  const [introDone, setIntroDone] = useState(() => shouldSkipIntro() || introPlayedThisSession());

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [home, profiles] = await Promise.all([fetchHome(), fetchProfiles()]);
      if (home !== null) {
        setRd(home.rd);
        setWatching(home.continueWatching.map(asTitle));
        setWatchlist((home.watchlist ?? []).map(asTitle));
        setRails(home.rails ?? []);
        setFeatured(home.featured !== null && home.featured !== undefined ? asTitle(home.featured) : null);
      }
      const active = profiles.profiles.find((entry) => entry.id === profiles.activeId);
      setProfile(active ?? profiles.profiles[0] ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPlan()
      .then(async (next) => {
        if (cancelled) return;
        applyPlanClass(next);
        setPlan(next);
        await reload();
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (loading || rd.configured) return;
    const timer = window.setTimeout(() => requestFocus(`${scope}/token`), 0);
    return () => window.clearTimeout(timer);
  }, [loading, rd.configured, scope]);

  const connect = async (raw?: string): Promise<void> => {
    const trimmed = (raw ?? token).trim();
    if (trimmed === '') {
      setMessage('Paste a token, then press OK.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const status = await saveRdToken(trimmed);
      if (status.error === 'needs-auth') {
        setMessage('Real-Debrid rejected that token.');
        return;
      }
      if (!status.configured) {
        setMessage('The token was not stored.');
        return;
      }
      setToken('');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The token was not stored.');
    } finally {
      setBusy(false);
    }
  };

  const openTitle = (title: Title): void => {
    openDetails(navigate, title);
  };

  const visibleRails = useMemo(() => {
    return rails
      .map((rail) => ({
        ...rail,
        titles: rail.items.map(asTitle).filter((title) => inLane(title, lane)),
      }))
      .filter((rail) => rail.titles.length > 0);
  }, [lane, rails]);

  const watchingLane = lane !== 'movies' ? watching : [];
  const billboard = featured ?? watchingLane[0] ?? visibleRails[0]?.titles[0];
  const heroSrc = billboard === undefined ? '' : preferBackdrop(billboard.id, billboard.backdrop, billboard.poster);

  return (
    <main className={`home stream-page stream-page--${plan.stream}`}>
      {!introDone && <TvmIntro variant="stream" pending={loading} onDone={() => setIntroDone(true)} />}
      <StreamChrome profile={profile} lane={lane} onLane={setLane} />

      {loading && introDone ? (
        <LoadingScreen
          variant="stream"
          holdIfRecent
          eyebrow="TVM Stream"
          title="Loading library…"
          body="Reading your catalog and Real-Debrid status on this machine."
        />
      ) : loading ? null : !rd.configured ? (
        <section className="stream-connect" aria-labelledby="stream-connect-title">
          <p className="stage__kicker">TVM Stream</p>
          <h1 id="stream-connect-title" className="page__heading">
            Connect Real-Debrid to watch
          </h1>
          <p className="page__lede">
            Home and the other apps stay open without this. Paste the API token from real-debrid.com/apitoken, then
            press OK. TVM keeps it on this machine until you change it in Settings or fully reset.
          </p>
          {message !== null && <p className="page__message">{message}</p>}
          <label className="token-field">
            <span>Real-Debrid API token</span>
            <FocusField
              id="token"
              type="password"
              value={token}
              onChange={setToken}
              onConfirm={(value) => void connect(value)}
              afterPasteFocusId="save"
              placeholder="Paste token, then press OK"
            />
          </label>
          <div className="hero__actions">
            <FocusButton id="save" variant="primary" disabled={busy} onSelect={() => void connect(fieldValue('token'))}>
              {busy ? 'Connecting…' : 'Continue'}
            </FocusButton>
            <FocusButton id="stream-back" className="tvm-button--glass" onSelect={() => navigate.home()}>
              Back to Home
            </FocusButton>
          </div>
        </section>
      ) : null}

      {rd.configured && !loading && plan.stream !== 'basic' && billboard !== undefined && (
        <section className="stage">
          <HeroArt src={heroSrc} hue={billboard.hue} />
          <div className="stage__vignette" aria-hidden="true" />
          <div className="stage__copy">
            <h1 className="stage__title">{billboard.title}</h1>
            <p className="stage__watchline">
              <FocusButton id="stream-hero-play" className="stage__watchnow" onSelect={() => openTitle(billboard)}>
                WATCH NOW
              </FocusButton>
              <span className="stage__watchline-rule" aria-hidden="true">
                |
              </span>
              <BrandLockup focusId="stream-hero-mark" />
            </p>
            <FocusButton id="stream-hero-info" className="tvm-button--glass stage__learn" onSelect={() => openTitle(billboard)}>
              Learn More
            </FocusButton>
          </div>
        </section>
      )}

      {rd.configured && !loading && watchingLane.length > 0 && (
        <Rail title="Continue Watching">
          {mapRailPosters(watchingLane, 'continue', openTitle, { layout: 'landscape' })}
        </Rail>
      )}

      {rd.configured && !loading && watchlist.length > 0 && (
        <Rail title="My List">
          {mapRailPosters(
            watchlist.filter((title) => inLane(title, lane)),
            'liked',
            openTitle,
          )}
        </Rail>
      )}

      {rd.configured &&
        !loading &&
        visibleRails.slice(0, plan.stream === 'basic' ? 2 : visibleRails.length).map((rail) => (
          <Rail key={rail.id} title={rail.title}>
            {mapRailPosters(rail.titles, rail.id, openTitle)}
          </Rail>
        ))}
    </main>
  );
}
