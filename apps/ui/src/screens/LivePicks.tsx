import { useCallback, useEffect, useState } from 'react';
import { ChannelCard } from '../components/ChannelCard';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import { ChannelSkeletons } from '../components/Skeleton';
import { fetchLiveCatalog, setLiveGroupPicks, toggleLivePick, type LiveCatalogPage, type LiveGroup } from '../data/media';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const PAGE = 24;

const EMPTY: LiveCatalogPage = {
  items: [],
  groups: [],
  total: 0,
  matched: 0,
  offset: 0,
  limit: PAGE,
  picked: 0,
  pickLimit: 48,
  query: '',
  group: null,
};

function groupId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `group-${slug || 'live'}`;
}

export function LivePicks(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<LiveCatalogPage>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextQuery: string, nextGroup: string | null, nextOffset: number): Promise<void> => {
    setBusy(true);
    try {
      const body = await fetchLiveCatalog({
        q: nextQuery,
        group: nextGroup ?? undefined,
        offset: nextOffset,
        limit: PAGE,
      });
      setPage(body);
      setMessage(null);
    } catch {
      setMessage('The channel list could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, [scope]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(query.trim(), group, offset);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [group, load, offset, query]);

  const refreshAfter = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await work();
      await load(query.trim(), group, offset);
    } catch {
      setMessage('That channel could not be updated.');
      setBusy(false);
    }
  };

  const groups: LiveGroup[] = page.groups;
  const atLimit = page.picked >= page.pickLimit;
  const pageCount = Math.max(1, Math.ceil(page.matched / PAGE));
  const pageNumber = Math.floor(offset / PAGE) + 1;

  return (
    <main className="page page--settings page--library page--docked page--live">
      <PageScene />
      <Ribbon active="live" />
      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Live TV lineup</p>
          <h1 className="page__heading">Choose channels</h1>
        </div>
      </header>
      <p className="page__lede">
        {page.total === 0
          ? 'Add a playlist first, then pick the channels you watch.'
          : `${page.picked} of ${page.pickLimit} on Live TV · ${page.total} in the playlist. Same lineup on this computer and Roku.`}
      </p>
      {message !== null && <p className="page__message">{message}</p>}
      <label className="token-field">
        <span>Search</span>
        <FocusField
          id="query"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          onConfirm={(value) => {
            setQuery(value);
            setOffset(0);
          }}
          afterPasteFocusId="done"
          placeholder="Name or group"
        />
      </label>
      <div className={`channel-chips${busy ? ' channel-chips--busy' : ''}`} aria-label="Groups">
        <FocusButton
          id="group-all"
          className={`channel-chip${group === null ? ' channel-chip--on' : ''}`}
          onSelect={() => {
            setGroup(null);
            setOffset(0);
            window.setTimeout(() => requestFocus(`${scope}/group-all`), 0);
          }}
        >
          All
        </FocusButton>
        {groups.map((entry) => (
          <FocusButton
            key={entry.name}
            id={groupId(entry.name)}
            className={`channel-chip${group === entry.name ? ' channel-chip--on' : ''}`}
            onSelect={() => {
              setGroup(entry.name);
              setOffset(0);
              window.setTimeout(() => requestFocus(`${scope}/${groupId(entry.name)}`), 0);
            }}
          >
            {entry.name}
            <span className="channel-chip__count">{entry.picked}/{entry.count}</span>
          </FocusButton>
        ))}
      </div>
      <div className="hero__actions">
        <FocusButton id="done" variant="primary" onSelect={() => navigate.pop()}>
          Done
        </FocusButton>
        {group !== null ? (
          <FocusButton
            id="add-group"
            disabled={busy}
            onSelect={() => void refreshAfter(() => setLiveGroupPicks(group, true))}
          >
            Add this group
          </FocusButton>
        ) : null}
        {group !== null ? (
          <FocusButton
            id="clear-group"
            disabled={busy}
            onSelect={() => void refreshAfter(() => setLiveGroupPicks(group, false))}
          >
            Remove group
          </FocusButton>
        ) : null}
        <FocusButton id="playlist" onSelect={() => navigate.push('live-playlist')}>
          Playlist
        </FocusButton>
      </div>
      {atLimit ? <p className="page__lede">Live TV holds {page.pickLimit} channels. Remove one to add another.</p> : null}
      <div className="channel-grid" data-wrap="grid" aria-label="Playlist channels" aria-busy={busy ? 'true' : undefined}>
        {busy && page.items.length === 0 ? (
          <ChannelSkeletons label="Loading channels" />
        ) : (
          page.items.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            focusId={`pick-${channel.id.replaceAll(':', '-')}`}
            picking
            onSelect={() => {
              if (channel.picked !== true && atLimit) {
                setMessage(`Live TV holds ${page.pickLimit} channels. Remove one to add another.`);
                return;
              }
              void refreshAfter(() => toggleLivePick(channel.id, channel.picked !== true));
            }}
          />
          ))
        )}
      </div>
      {page.matched > PAGE ? (
        <div className="hero__actions">
          <FocusButton
            id="prev-page"
            disabled={offset === 0 || busy}
            onSelect={() => setOffset(Math.max(0, offset - PAGE))}
          >
            Previous
          </FocusButton>
          <FocusButton
            id="next-page"
            disabled={offset + PAGE >= page.matched || busy}
            onSelect={() => setOffset(offset + PAGE)}
          >
            Next
          </FocusButton>
          <span className="page__lede">
            Page {pageNumber} of {pageCount}
          </span>
        </div>
      ) : null}
      <OnScreenKeyboard
        value={query}
        onChange={(value) => {
          setQuery(value);
          setOffset(0);
        }}
        onSubmit={() => {
          setQuery(fieldValue('query') || query);
          setOffset(0);
        }}
        idPrefix="pick-key"
      />
    </main>
  );
}
