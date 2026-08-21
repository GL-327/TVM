import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { AppCard } from '../components/AppCard';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { IconSearch } from '../components/Icons';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { PosterCard } from '../components/PosterCard';
import { RailSkeletons } from '../components/Skeleton';
import { appTileOpen, fallbackApps, fetchApps, prefetchAppHub, searchApps } from '../data/apps';
import type { AppTile } from '../data/catalog';
import { isHttpUrl } from '../data/links';
import { asTitle, searchLibrary, type MediaItem } from '../data/media';
import { openDetails } from '../data/openDetails';
import { enterTvmStream } from '../data/profiles';
import { searchEaster } from '../brand/easterEggs';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function SearchModal({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const fromHome = params['from'] === 'home';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [apps, setApps] = useState<AppTile[]>(() => (fromHome ? fallbackApps().grid : []));
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState(
    fromHome ? 'Search films, series, and apps, or paste a hoster link.' : 'Search films and series, or paste a hoster link.',
  );
  const armed = useRef(false);

  const close = useCallback((): void => {
    navigate.pop();
  }, [navigate]);

  const dismissScrim = useCallback(
    (event: MouseEvent<HTMLDivElement>): void => {
      if (!armed.current || event.target !== event.currentTarget) return;
      close();
    },
    [close],
  );

  const appHits = fromHome ? searchApps(query, { ribbon: apps, grid: apps }) : [];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      armed.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => requestFocus(`${scope}/query`), 16);
    return () => window.clearTimeout(timer);
  }, [scope]);

  useEffect(() => {
    if (!fromHome) return undefined;
    let cancelled = false;
    void fetchApps().then((catalog) => {
      if (!cancelled) setApps(catalog.grid.length > 0 ? catalog.grid : catalog.ribbon);
    });
    return () => {
      cancelled = true;
    };
  }, [fromHome]);

  useEffect(() => {
    const trimmed = query.trim();
    const egg = searchEaster(trimmed);
    if (egg !== null) {
      setResults([]);
      setSearching(false);
      setMessage(egg);
      return;
    }
    if (trimmed.length < 2 || isHttpUrl(trimmed)) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchLibrary(trimmed)
        .then((items) => {
          if (cancelled) return;
          setResults(items);
          const appsMatched = fromHome ? searchApps(trimmed, { ribbon: apps, grid: apps }).length : 0;
          if (items.length === 0 && appsMatched === 0) setMessage('Nothing matched that search.');
          else setMessage(`${items.length + appsMatched} matches`);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apps, fromHome, query]);

  const openApp = useCallback(
    (app: AppTile): void => {
      navigate.pop();
      const dest = appTileOpen(app.id);
      if (dest.kind === 'library') {
        void enterTvmStream(navigate);
        return;
      }
      prefetchAppHub(dest.id);
      navigate.push('service', { params: { id: dest.id } });
    },
    [navigate],
  );

  const open = useCallback(async (raw?: string): Promise<void> => {
    const trimmed = (raw ?? query).trim();
    if (trimmed === '') return;
    const egg = searchEaster(trimmed);
    if (egg !== null) {
      setMessage(egg);
      return;
    }
    if (isHttpUrl(trimmed)) {
      navigate.pop();
      navigate.pushModal('player', { params: { link: trimmed } });
      return;
    }
    const matchedApps = fromHome ? searchApps(trimmed, { ribbon: apps, grid: apps }) : [];
    if (matchedApps[0] !== undefined) {
      openApp(matchedApps[0]);
      return;
    }
    const items = results.length > 0 ? results : await searchLibrary(trimmed);
    setResults(items);
    if (items[0] === undefined) {
      setMessage('Nothing matched that search.');
      return;
    }
    navigate.pop();
    openDetails(navigate, asTitle(items[0]));
  }, [apps, fromHome, navigate, openApp, query, results]);

  return (
    <div
      className="panel-scrim search-pill"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      onClick={dismissScrim}
    >
      <section className="search-pill__panel" onClick={(event) => event.stopPropagation()}>
        <div className="search-pill__bar" data-wrap="row">
          <span className="search-pill__glyph" aria-hidden="true">
            <IconSearch />
          </span>
          <label className="search-pill__field">
            <span className="search-pill__sr">Link, title, or app</span>
            <FocusField
              id="query"
              value={query}
              onChange={setQuery}
              onConfirm={(value) => void open(value)}
              afterPasteFocusId="open"
              placeholder={fromHome ? 'Title, app, or https://…' : 'Title or https://…'}
            />
          </label>
          <FocusButton id="open" variant="primary" onSelect={() => void open(fieldValue('query'))}>
            Open
          </FocusButton>
          <FocusButton id="close" onSelect={close}>
            Close
          </FocusButton>
        </div>
        <p className="search-pill__status">{searching ? 'Searching…' : message}</p>
        <OnScreenKeyboard value={query} onChange={setQuery} onSubmit={() => void open()} />
        {searching && results.length === 0 && appHits.length === 0 && (
          <div className="search-results" aria-busy="true" aria-label="Search results loading">
            <RailSkeletons count={6} label="Searching" />
          </div>
        )}
        {appHits.length > 0 && (
          <div className="search-results search-results--apps" aria-label="App results">
            {appHits.slice(0, 8).map((app) => (
              <AppCard key={app.id} app={app} id={`search-app-${app.id}`} size="ribbon" onSelect={() => openApp(app)} />
            ))}
          </div>
        )}
        {results.length > 0 && (
          <div className="search-results" aria-label="Search results">
            {results.slice(0, 24).map((item, index) => (
              <PosterCard
                key={`${item.id}-${index}`}
                title={asTitle(item)}
                prefix="result"
                index={index}
                onSelect={() => {
                  navigate.pop();
                  openDetails(navigate, asTitle(item));
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
