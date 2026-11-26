import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openModals, visibleScreen } from '@tvm/nav';
import { BrowseAmbience } from '../components/BrowseAmbience';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { LoadingScreen } from '../components/LoadingScreen';
import { introPlayedThisSession, shouldSkipIntro, TvmIntro } from '../brand/TvmIntro';
import { mapRailPosters } from '../components/PosterCard';
import { Rail, RailPaging } from '../components/Rail';
import { Ribbon } from '../components/Ribbon';
import { type Title } from '../data/catalog';
import {
  apiFetch,
  asTitle,
  fetchHome,
  peekHome,
  saveRdToken,
  toMediaItem,
  type CatalogRail,
  type RdStatus,
  type MediaItem,
} from '../data/media';
import { filterItemsByAge } from '../data/parental';
import { usePagedRails } from '../data/usePagedRails';
import { openDetails, openPlayback } from '../data/openDetails';
import { applyPlanClass, FALLBACK_PLAN, fetchPlan, type PlanStatus } from '../data/plan';
import { effectiveProfileMaxAge, fetchProfiles, type Profile } from '../data/profiles';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate, useViewStack } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

import { useExtraPrefs, uiExtraEnabled } from '../data/uiExtras';
import { prefersReducedMotion, subscribeMotionPreference } from '../theme/motion';
import { Spotlight } from './Spotlight';

const RD_EMPTY: RdStatus = { configured: false, username: null, premium: false, error: null };

function inLane(title: Title, lane: 'all' | 'shows' | 'movies'): boolean {
  if (lane === 'all') return true;
  if (lane === 'shows') return title.kind === 'series';
  return title.kind !== 'series';
}

export function Library({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const stack = useViewStack();
  const active = visibleScreen(stack).name === 'library' && openModals(stack).length === 0;
  const page = useRef<HTMLElement>(null);
  const heroVisible = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const prefs = useExtraPrefs();
  const [surprise, setSurprise] = useState<MediaItem | null>(null);
  const cached = peekHome();
  const [watching, setWatching] = useState<Title[]>(() => (cached?.continueWatching ?? []).map(asTitle));
  const [watchlist, setWatchlist] = useState<Title[]>(() => (cached?.watchlist ?? []).map(asTitle));
  const [rails, setRails] = useState<CatalogRail[]>(cached?.rails ?? []);
  const { rails: pagedRails, loadMore: loadMoreRail } = usePagedRails(rails);
  const [featured, setFeatured] = useState<Title | null>(() =>
    cached?.featured !== null && cached?.featured !== undefined ? asTitle(cached.featured) : null,
  );
  const [rd, setRd] = useState<RdStatus>(cached?.rd ?? RD_EMPTY);
  const rdReady = rd.configured && rd.error !== 'needs-auth';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lane, setLane] = useState<'all' | 'shows' | 'movies'>(() => params.lane === 'movies' || params.lane === 'shows' ? params.lane : 'all');
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
    if (loading || rdReady) return;
    const timer = window.setTimeout(() => requestFocus(`${scope}/token`), 0);
    return () => window.clearTimeout(timer);
  }, [loading, rdReady, scope]);

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

  const openTitle = useCallback((title: Title): void => openDetails(navigate, title), [navigate]);

  const maxAge = effectiveProfileMaxAge(profile);
  const visibleRails = useMemo(() => {
    return pagedRails
      .map((rail) => ({
        ...rail,
        titles: filterItemsByAge(rail.items, maxAge).map(asTitle).filter((title) => inLane(title, lane)),
      }))
      .filter((rail) => rail.titles.length > 0);
  }, [lane, maxAge, pagedRails]);

  const watchingLane = useMemo(
    () => filterItemsByAge(watching.map(toMediaItem), maxAge).map(asTitle).filter((title) => inLane(title, lane)),
    [lane, maxAge, watching],
  );
  const visibleWatchlist = useMemo(
    () => filterItemsByAge(watchlist.map(toMediaItem), maxAge).map(asTitle).filter((title) => inLane(title, lane)),
    [lane, maxAge, watchlist],
  );
  const eligibleFeatured = featured && inLane(featured, lane) && filterItemsByAge([toMediaItem(featured)], maxAge).length ? featured : null;
  const candidates = [...new Map([...(eligibleFeatured ? [eligibleFeatured] : []),
    ...visibleRails.flatMap((rail) => rail.titles)].map((title) => [title.id, title])).values()];
  const featuredTitles = candidates.filter((title) => title.backdrop !== '').slice(0, 8);
  const billboard = featuredTitles[0] ?? candidates[0] ?? watchingLane[0];
  const showHero = rdReady && !loading && billboard !== undefined;
  const maySurprise = uiExtraEnabled('surpriseMe', prefs);

  useEffect(() => {
    const sync = (): void => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    const unsubscribe = subscribeMotionPreference(() => setReduced(prefersReducedMotion()));
    return () => { document.removeEventListener('visibilitychange', sync); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!showHero || !heroVisible.current) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting === true),
      { root: page.current, threshold: 0.45 });
    observer.observe(heroVisible.current);
    return () => observer.disconnect();
  }, [showHero]);
  useEffect(() => {
    setSurprise(null);
    if (!active || !maySurprise) return;
    const controller = new AbortController();
    void apiFetch('/api/extras/surprise', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const { item } = await response.json() as { item?: MediaItem };
      if (item && !controller.signal.aborted && filterItemsByAge([item], maxAge).length) setSurprise(item);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [active, maxAge, maySurprise]);
  const selectLane = (next: typeof lane): void => {
    if (next === lane) return;
    setLane(next);
    page.current?.scrollTo({ top: 0 });
  };

  return (
    <main ref={page} className={`home stream-page stream-page--${plan.stream} cinematic-browse`}>
      <BrowseAmbience page={page} />
      {!introDone && <TvmIntro variant="stream" pending={loading} onDone={() => setIntroDone(true)} />}
      <Ribbon active={lane === 'all' ? 'library' : lane} onLane={selectLane} />

      {loading && introDone ? (
        <LoadingScreen
          variant="stream"
          holdIfRecent
          eyebrow="TVM Stream"
          title="Loading library…"
          body="Reading your catalog and Real-Debrid status on this machine."
        />
      ) : loading ? null : !rdReady ? (
        <section className="stream-connect" aria-labelledby="stream-connect-title">
          <p className="stage__kicker">TVM Stream</p>
          <h1 id="stream-connect-title" className="page__heading">
            Connect Real-Debrid to watch
          </h1>
          <p className="page__lede">
            Home and the other apps stay open without this. Paste the API token from real-debrid.com/apitoken, then
            press OK. TVM encrypts it on this machine and sends it to Real-Debrid and the Torrentio resolver for
            catalogue playback. Connect only sources you are authorised to use. Review Privacy & terms in Settings.
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
            <FocusButton id="stream-back" className="tvm-button--glass" onSelect={() => navigate.pop()}>
              Back
            </FocusButton>
          </div>
        </section>
      ) : null}

      {showHero && <div ref={heroVisible} className="browse__hero">
        <Spotlight hero={billboard} event={null} enabled={prefs.heroPreviews} reduced={reduced}
          active={active && onScreen && visible} rating={uiExtraEnabled('ratings', prefs)}
          onPlay={() => openPlayback(navigate, billboard)} onDetails={() => openTitle(billboard)}
          onSurprise={maySurprise && surprise ? () => openTitle(asTitle(surprise)) : undefined} />
      </div>}

      {rdReady && !loading && watchingLane.length > 0 && (
        <Rail title="Continue Watching" loop={false}>
          {mapRailPosters(watchingLane, 'continue', openTitle, { layout: 'landscape' })}
        </Rail>
      )}

      {rdReady && !loading && featuredTitles.length > 0 && (
        <Rail title="Featured" id="library-featured" loop={false}>
          {mapRailPosters(featuredTitles, 'library-featured', openTitle, { layout: 'landscape' })}
        </Rail>
      )}

      {rdReady && !loading && visibleWatchlist.length > 0 && (
        <Rail title="My List" loop={false}>
          {mapRailPosters(
            visibleWatchlist,
            'liked',
            openTitle,
          )}
        </Rail>
      )}

      {rdReady &&
        !loading &&
        visibleRails.slice(0, plan.stream === 'basic' ? 2 : visibleRails.length).map((rail) => (
          <RailPaging key={rail.id} railId={rail.id} hasMore={rail.more === true} onNearEnd={() => loadMoreRail(rail.id)}>
            <Rail key={rail.id} title={rail.title}>
              {mapRailPosters(rail.titles, rail.id, openTitle)}
            </Rail>
          </RailPaging>
        ))}
    </main>
  );
}
