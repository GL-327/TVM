import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { PosterCard } from '../components/PosterCard';
import { isHttpUrl } from '../data/links';
import { asTitle, searchLibrary, type MediaItem } from '../data/media';
import { openDetails } from '../data/openDetails';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function SearchModal(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [message, setMessage] = useState('Search films and series, or paste a hoster link.');

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || isHttpUrl(trimmed)) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchLibrary(trimmed).then((items) => {
        if (cancelled) return;
        setResults(items);
        setMessage(items.length === 0 ? 'Nothing matched that search.' : `${items.length} titles`);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const open = useCallback(async (raw?: string): Promise<void> => {
    const trimmed = (raw ?? query).trim();
    if (trimmed === '') return;
    if (isHttpUrl(trimmed)) {
      navigate.pop();
      navigate.pushModal('player', { params: { link: trimmed } });
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
  }, [navigate, query, results]);

  return (
    <div className="panel-scrim" role="dialog" aria-modal="true" aria-label="Search">
      <section className="panel panel--search">
        <h2 className="panel__title">Search</h2>
        <p className="page__lede">{message}</p>
        <label className="token-field">
          <span>Link or title</span>
          <FocusField
            id="query"
            value={query}
            onChange={setQuery}
            onConfirm={(value) => void open(value)}
            afterPasteFocusId="open"
            placeholder="Title or https://…"
          />
        </label>
        <div className="hero__actions">
          <FocusButton id="open" variant="primary" onSelect={() => void open(fieldValue('query'))}>
            Open
          </FocusButton>
          <FocusButton id="close" onSelect={() => navigate.pop()}>
            Close
          </FocusButton>
        </div>
        <OnScreenKeyboard value={query} onChange={setQuery} onSubmit={() => void open()} />
        {results.length > 0 && (
          <div className="search-results" aria-label="Search results">
            {results.slice(0, 24).map((item) => (
              <PosterCard
                key={item.id}
                title={asTitle(item)}
                prefix="result"
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
