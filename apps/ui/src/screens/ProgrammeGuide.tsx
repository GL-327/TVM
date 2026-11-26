import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { IconSearch } from '../components/Icons';
import { fetchGuide, GUIDE_HOURS, GUIDE_REFRESH_LIMIT, GUIDE_REFRESH_MS, guideStart, HALF_HOUR, MINUTE, programmeAt, type GuideChannel, type GuideData, type Programme } from '../data/guide';
import { filterChannelsByAge } from '../data/freeLive';
import { requestFocus } from '../nav/focusEngine';
import { useFocusScope, useNavigate } from '../nav/ViewStackContext';
import './guide.css';

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dates = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const favouritesKey = 'tvm.guide.favourites';
const asTime = (value: string): number => +new Date(value);
const cellId = (channel: GuideChannel, index: number): string => 'guide-cell-' + channel.id + '-' + index;

function favouritesStored(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(favouritesKey) ?? '[]') as string[]); } catch { return new Set(); }
}

export function ProgrammeGuide({ fallback, maxAge, onChannels, watch }: {
  fallback: GuideChannel[]; maxAge: number; onChannels: () => void; watch: (channel: GuideChannel) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const scope = useFocusScope();
  const viewport = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);
  const [day, setDay] = useState(0);
  const [start, setStart] = useState(() => guideStart(Date.now(), 0));
  const [data, setData] = useState<GuideData | null>(null);
  const [offset, setOffset] = useState(0);
  const [group, setGroup] = useState('');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [favourites, setFavourites] = useState(favouritesStored);
  const [selected, setSelected] = useState<{ channel: string; index: number } | null>(null);
  const tune = useRef({ digits: '', timer: 0 });
  const [tuneDigits, setTuneDigits] = useState('');
  const chooseAfterLoad = useRef<string | null>(null);
  const end = start + GUIDE_HOURS * 60 * MINUTE;

  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    // The first visit races Core's feed download; keep asking while it says a fuller
    // answer is on the way, so listings replace "No guide information" by themselves.
    const load = (attempt: number): void => {
      void fetchGuide(start, controller.signal).then((next) => {
        if (controller.signal.aborted) return;
        if (next || attempt === 0) {
          setData(next);
          setOffset(next ? asTime(next.now) - Date.now() : 0);
        }
        if (next?.refreshing && attempt < GUIDE_REFRESH_LIMIT) timer = window.setTimeout(() => load(attempt + 1), GUIDE_REFRESH_MS);
      });
    };
    load(0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [start]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(tune.current.timer);
    };
  }, []);

  const channels = useMemo(() => {
    const byId = new Map(fallback.map((item) => [item.id, item]));
    for (const channel of data?.channels ?? []) byId.set(channel.id, channel);
    return filterChannelsByAge(Array.from(byId.values()), maxAge);
  }, [data, fallback, maxAge]);
  const groups = Array.from(new Set(channels.map((channel) => channel.group).filter(Boolean))).sort();
  const visible = channels.filter((channel) => (!group || (group === 'favourites' ? favourites.has(channel.id) : channel.group === group))
    && channel.name.toLowerCase().includes(query.trim().toLowerCase()));
  const serverNow = now + offset;

  const programmes = (channel: GuideChannel): Programme[] => {
    const items = channel.programmes.filter((programme) => asTime(programme.end) > start && asTime(programme.start) < end)
      .sort((a, b) => asTime(a.start) - asTime(b.start));
    return items.length ? items : [{ start: new Date(start).toISOString(), end: new Date(end).toISOString(), title: 'No guide information' }];
  };
  const row = visible.find((channel) => channel.id === selected?.channel) ?? visible[0];
  const index = row?.id === selected?.channel ? selected?.index ?? 0 : row ? programmeAt(programmes(row), serverNow) : 0;
  const active = row ? programmes(row)[index] : undefined;
  const isNow = active && asTime(active.start) <= serverNow && asTime(active.end) > serverNow;

  const select = (channel: GuideChannel, at: number, focus = true): void => {
    setSelected({ channel: channel.id, index: at });
    if (focus) {
      requestFocus(scope + '/' + cellId(channel, at));
      viewport.current?.querySelector<HTMLElement>('[data-focus-id="' + CSS.escape(cellId(channel, at)) + '"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  useEffect(() => {
    const id = chooseAfterLoad.current;
    if (!id || !data || asTime(data.start) !== start) return;
    chooseAfterLoad.current = null;
    const channel = visible.find((item) => item.id === id);
    if (channel) select(channel, programmeAt(programmes(channel), start));
  }, [data, start]);

  const changeStart = (value: number): void => {
    setStart(value);
    setSelected(null);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  };

  const keyboard = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      if (event.key === 'Escape' && searching) {
        event.preventDefault();
        setSearching(false);
        setQuery('');
      }
      return;
    }
    if (/^\d$/.test(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const digits = (tune.current.digits + event.key).slice(-4);
      setTuneDigits(digits);
      window.clearTimeout(tune.current.timer);
      tune.current = { digits, timer: window.setTimeout(() => {
        setTuneDigits('');
        tune.current.digits = '';
        const channel = channels.find((entry) => Number(entry.number) === Number(digits));
        if (channel) watch(channel);
      }, 1500) };
      return;
    }
    if (!row || !active || !(event.target as HTMLElement).closest('.guide__cell')) return;
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter'].includes(key)) return;
    event.preventDefault(); event.stopPropagation();
    if (key === 'Enter') { watch(row); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const next = index + (key === 'ArrowLeft' ? -1 : 1);
      if (programmes(row)[next]) select(row, next);
      else if (next < 0) {
        chooseAfterLoad.current = row.id;
        changeStart(start - HALF_HOUR);
      }
      return;
    }
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -8, PageDown: 8 }[key] ?? 0;
    const nextRow = visible[Math.max(0, Math.min(visible.length - 1, visible.indexOf(row) + step))];
    const time = isNow ? serverNow : Math.max(start, asTime(active.start));
    if (nextRow) select(nextRow, programmeAt(programmes(nextRow), time));
  };

  const favourite = (): void => {
    if (!row) return;
    const next = new Set(favourites);
    if (!next.delete(row.id)) next.add(row.id);
    setFavourites(next);
    try { localStorage.setItem(favouritesKey, JSON.stringify([...next])); } catch { /* Keep the current selection. */ }
  };

  const x = (time: number): number => Math.min(100, Math.max(0, 100 * (time - start) / (end - start)));
  return <section className="guide" aria-label="Live TV programme guide" onKeyDownCapture={keyboard}>
    <header className="guide__toolbar">
      <div className="page__toolbar-lead"><BackButton id="live-back" /><h1 className="live-heading">Guide</h1></div>
      <div className="guide__filters">
        <select className="polish-select" aria-label="Guide day" value={day} onChange={(event) => {
          const next = Number(event.currentTarget.value); setDay(next); changeStart(guideStart(now, next));
        }}>
          {[-1, 0, 1, 2, 3, 4, 5, 6].map((date) => <option key={date} value={date}>
            {date === 0 ? 'Today' : date === -1 ? 'Yesterday' : date === 1 ? 'Tomorrow' : dates.format(guideStart(now, date))}
          </option>)}
        </select>
        <select className="polish-select" aria-label="Filter channels" value={group} onChange={(event) => {
          setGroup(event.currentTarget.value); setSelected(null);
        }}>
          <option value="">All channels</option><option value="favourites">Favourites</option>
          {groups.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <FocusButton id="guide-search" className="guide__search" ariaLabel="Search channels" ariaExpanded={searching} tabIndex={0}
          onSelect={() => { setSearching(!searching); if (searching) setQuery(''); }}><IconSearch /></FocusButton>
        <FocusButton id="live-channels" className="guide__utility" tabIndex={0} onSelect={onChannels}>Channels</FocusButton>
        <time className="guide__clock" dateTime={new Date(serverNow).toISOString()}>{clock.format(serverNow)}</time>
      </div>
    </header>
    {searching && <input className="polish-field guide__query" type="search" placeholder="Search channels" autoFocus
      aria-label="Search channels" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />}
    {tuneDigits && <output className="guide__tune" aria-live="polite">{tuneDigits}</output>}
    <div ref={viewport} className="guide__viewport" onWheel={(event) => {
      if (event.shiftKey && event.deltaY && viewport.current) viewport.current.scrollLeft += event.deltaY;
    }}>
      <div className="guide__grid" style={{ '--guide-hours': GUIDE_HOURS } as CSSProperties}>
        <div className="guide__timeline" aria-hidden="true">
          <div className="guide__channel guide__channel--heading">Channels</div>
          <div className="guide__ticks">
            {Array.from({ length: GUIDE_HOURS * 2 }, (_, i) =>
              <span key={i}>{clock.format(start + i * HALF_HOUR)}</span>)}
            {serverNow >= start && serverNow < end && <i className="guide__now-dot" style={{ left: x(serverNow) + '%' }} />}
          </div>
        </div>
        {visible.map((channel) => <div className="guide__row" key={channel.id}>
          <div className="guide__channel"><b>{channel.number}</b>
            <GuideChannelLogo key={channel.logo ?? ''} name={channel.name} logo={channel.logo} />
            <span>{channel.name}</span>
          </div>
          <div className="guide__programmes">
            {programmes(channel).map((programme, i) => {
              const from = asTime(programme.start);
              const to = asTime(programme.end);
              const airing = from <= serverNow && to > serverNow && programme.title !== 'No guide information';
              const selectedCell = row?.id === channel.id && index === i;
              return <div key={programme.start + i} className="guide__slot" style={{
                left: x(from) + '%', width: Math.max(.1, x(to) - x(from)) + '%',
                '--guide-elapsed': Math.max(0, Math.min(100, (serverNow - Math.max(start, from)) / (to - Math.max(start, from)) * 100)) + '%',
              } as CSSProperties}>
                <FocusButton id={cellId(channel, i)} ariaPressed={selectedCell} tabIndex={selectedCell ? 0 : -1}
                  ariaLabel={`${channel.name}, ${programme.title}`}
                  className={'guide__cell' + (airing ? ' guide__cell--now' : to <= serverNow ? ' guide__cell--past' : '')}
                  title={programme.title} onArrowPress={(direction) => {
                    const key = 'Arrow' + direction[0]?.toUpperCase() + direction.slice(1);
                    const node = viewport.current?.querySelector('[data-focus-id="' + CSS.escape(cellId(channel, i)) + '"]');
                    node?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
                    return false;
                  }}
                  onSelect={() => selected?.channel === channel.id && selected?.index === i ? watch(channel) : select(channel, i, false)}>
                  {programme.title}
                </FocusButton>
              </div>;
            })}
            {serverNow >= start && serverNow < end && <i className="guide__now-line" aria-hidden="true" style={{ left: x(serverNow) + '%' }} />}
          </div>
        </div>)}
      </div>
      {!visible.length && <p className="guide__empty">{group === 'favourites' ? 'Save a channel as a favourite to see it here.' : 'No matching channels.'}</p>}
    </div>
    {row && active && <section className="guide__info" aria-label="Selected programme">
      <GuideInfoArt key={(active.image ?? '') + '|' + (row.logo ?? '')} sources={[active.image, row.logo]} />
      <div className="guide__summary">
        <h2>{active.title}</h2>
        <div className="guide__meta">{isNow && active.title !== 'No guide information' && <b>Now</b>}
          <span>{row.name} · {clock.format(asTime(active.start))}–{clock.format(asTime(active.end))}</span>
          {active.category && <span className="guide__category">{active.category}</span>}
        </div>
        {(active.description || active.subtitle) && <p>{active.description ?? active.subtitle}</p>}
      </div>
      <div className="guide__actions">
        <FocusButton id="guide-favourite" className="guide__utility" ariaPressed={favourites.has(row.id)} tabIndex={0}
          onSelect={favourite}>{favourites.has(row.id) ? 'Saved' : 'Favourite'}</FocusButton>
        <FocusButton id="guide-watch" variant="primary" tabIndex={0} onSelect={() => watch(row)}>Watch</FocusButton>
      </div>
    </section>}
    <footer className="guide__setup">
      <FocusButton id="guide-playlist" variant="quiet" tabIndex={0} onSelect={() => navigate.push('live-playlist')}>M3U playlist</FocusButton>
      <FocusButton id="guide-xtream" variant="quiet" tabIndex={0} onSelect={() => navigate.push('live-xtream')}>Xtream login</FocusButton>
    </footer>
  </section>;
}

function GuideChannelLogo({ name, logo }: { name: string; logo?: string | null }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  return logo && !failed
    ? <img alt="" src={logo} loading="lazy" onError={() => setFailed(true)} />
    : <span className="guide__fallback-logo" aria-hidden="true">{name.slice(0, 2)}</span>;
}

/** Programme stills from listing feeds often refuse hotlinking; fall back to the channel logo, then to nothing. */
function GuideInfoArt({ sources }: { sources: Array<string | null | undefined> }): React.JSX.Element | null {
  const urls = sources.filter((url): url is string => typeof url === 'string' && url !== '');
  const [index, setIndex] = useState(0);
  const url = urls[index];
  return url ? <img className="guide__info-art" alt="" src={url} onError={() => setIndex(index + 1)} /> : null;
}
