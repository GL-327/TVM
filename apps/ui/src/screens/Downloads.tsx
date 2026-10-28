import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { FocusButton } from '../components/FocusButton';
import { fetchChildren, type MediaItem } from '../data/media';
import { downloadBridge, downloadHeaders, downloadsAvailable, type DownloadJob } from '../data/downloads';
import { fetchPlan } from '../data/plan';
import { playIdFor } from '../data/playId';
import { useNavigate, useScopedFocusKey } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './downloads.css';

function Choice({ id, label, value, change, children }: {
  id: string; label: string; value: string; change(value: string): void; children: ReactNode;
}): React.JSX.Element {
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLSelectElement>({ focusKey });
  return <label className="download-choice"><span>{label}</span><select ref={ref} data-focus-id={id}
    data-focused={focused ? 'true' : undefined} value={value} onChange={(event) => change(event.target.value)}>{children}</select></label>;
}

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

const ACTIVE = new Set(['queued', 'resolving', 'downloading']);

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', original: 'Original / any language', ja: 'Japanese', fr: 'French', de: 'German', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', ko: 'Korean', hi: 'Hindi',
};

/** The language and quality last chosen, so the next download starts with them. A blocked store is not an error. */
const CHOICE_KEY = 'tvm.downloads.choices';
function savedChoices(): { language: string; quality: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? '{}') as { language?: unknown; quality?: unknown };
    return {
      language: typeof raw.language === 'string' && raw.language in LANGUAGE_LABELS ? raw.language : 'en',
      quality: typeof raw.quality === 'string' && ['480', '720', '1080', '2160'].includes(raw.quality) ? raw.quality : '1080',
    };
  } catch { return { language: 'en', quality: '1080' }; }
}
function saveChoices(language: string, quality: string): void {
  try { localStorage.setItem(CHOICE_KEY, JSON.stringify({ language, quality })); } catch { /* private window */ }
}

export function Downloads({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const title = typeof params['title'] === 'string' ? params['title'] : 'Downloads';
  const series = params['series'] === true;
  const initialFiles = Array.isArray(params['episodes']) ? params['episodes'] as MediaItem[] : [];
  const [episodes, setEpisodes] = useState(initialFiles);
  const [loading, setLoading] = useState(series && initialFiles.length === 0);
  const [batch, setBatch] = useState(params['episode'] !== undefined ? 'episode' : 'series');
  const [season, setSeason] = useState(String(params['season'] ?? initialFiles[0]?.season ?? 1));
  const [episode, setEpisode] = useState(typeof params['episodeId'] === 'string' ? params['episodeId'] : initialFiles[0]?.id ?? '');
  const [language, setLanguage] = useState(() => savedChoices().language);
  const [quality, setQuality] = useState(() => savedChoices().quality);
  useEffect(() => saveChoices(language, quality), [language, quality]);
  const [maxHeight, setMaxHeight] = useState(1080);
  const [directory, setDirectory] = useState('');
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const bridge = downloadBridge();

  useEffect(() => {
    let cancelled = false;
    const sync = (): void => { void bridge.list().then((next) => { if (!cancelled) setJobs(next); }).catch(() => undefined); };
    sync(); const stop = bridge.onChanged(sync);
    void fetchPlan().then((plan) => { if (!cancelled) { setMaxHeight(plan.maxHeight); setQuality((current) => String(Math.min(plan.maxHeight, Number(current)))); } }).catch(() => undefined);
    return () => { cancelled = true; stop(); };
  }, [bridge]);

  useEffect(() => {
    if (!series || initialFiles.length > 0) return;
    let cancelled = false;
    void fetchChildren(id).then((files) => {
      if (cancelled) return;
      setEpisodes(files); setLoading(false);
      if (params['season'] === undefined) setSeason(String(files[0]?.season ?? 1));
      if (!episode) setEpisode(files[0]?.id ?? '');
    });
    return () => { cancelled = true; };
  }, [id, series]);

  const seasons = useMemo(() => [...new Set(episodes.map((file) => file.season).filter((value): value is number => value !== undefined))].sort((a, b) => a - b), [episodes]);
  const seasonEpisodes = episodes.filter((file) => String(file.season) === season);
  const selected = series ? episodes.filter((file) => batch === 'series' || (batch === 'season' ? String(file.season) === season : file.id === episode)) : [];
  const count = series ? selected.length : 1;
  const available = downloadsAvailable();

  const chooseFolder = async (): Promise<void> => {
    try { const chosen = await bridge.chooseFolder(); if (chosen !== null) { setDirectory(chosen); setMessage(''); } }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The folder could not be opened.'); }
  };
  const enqueue = async (): Promise<void> => {
    if (busy || !directory || count === 0) return;
    setBusy(true); setMessage('');
    try {
      const items = series ? selected.map((file) => ({
        id: playIdFor(file.id, file.season, file.episode),
        title: `${title} — S${String(file.season ?? 0).padStart(2, '0')}E${String(file.episode ?? 0).padStart(2, '0')}${file.episodeName ? ` — ${file.episodeName}` : ''}`,
      })) : [{ id: playIdFor(id), title }];
      setJobs(await bridge.enqueue({ directory, items, preferences: { language, maxHeight: Number(quality) }, headers: downloadHeaders() }));
      setMessage(`${items.length === 1 ? 'Download' : `${items.length} episodes`} added to the queue. You can keep browsing.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The download could not be started.'); }
    finally { setBusy(false); }
  };

  return <main className="page downloads" data-scroll-nearest="" role="dialog" aria-modal="true" aria-label="Downloads">
    <div className="downloads__content">
      <header className="downloads__header"><div><p className="downloads__eyebrow">YOUR OFFLINE LIBRARY</p><h1>{id ? 'Take it with you.' : 'Downloads'}</h1><p>{id ? title : 'Your downloads keep going while you browse.'}</p></div>
        <FocusButton id="downloads-close" variant="quiet" onSelect={() => navigate.pop()}>Close</FocusButton></header>
      {id && <section className="downloads__card" aria-label="Download options">
        <div className="downloads__form">
          {series && <Choice id="download-scope" label="What to download" value={batch} change={setBatch}><option value="series">Full series · {episodes.length} episodes</option><option value="season">One season</option><option value="episode">One episode</option></Choice>}
          {series && batch !== 'series' && <Choice id="download-season" label="Season" value={season} change={(value) => { setSeason(value); setEpisode(episodes.find((file) => String(file.season) === value)?.id ?? ''); }}>{seasons.map((value) => <option key={value} value={value}>Season {value}</option>)}</Choice>}
          {series && batch === 'episode' && <Choice id="download-episode" label="Episode" value={episode} change={setEpisode}>{seasonEpisodes.map((file) => <option key={file.id} value={file.id}>Episode {file.episode} · {file.episodeName ?? file.title}</option>)}</Choice>}
          <Choice id="download-language" label="Audio language" value={language} change={setLanguage}>
            <option value="en">English</option><option value="original">Original / any language</option><option value="ja">Japanese</option><option value="fr">French</option><option value="de">German</option><option value="es">Spanish</option><option value="it">Italian</option><option value="pt">Portuguese</option><option value="ko">Korean</option><option value="hi">Hindi</option>
          </Choice>
          <Choice id="download-quality" label="Maximum quality" value={quality} change={setQuality}>{[480, 720, 1080, 2160].filter((value) => value <= maxHeight).map((value) => <option key={value} value={value}>{value === 2160 ? '4K · 2160p' : `${value}p`}</option>)}</Choice>
        </div>
        <p className="downloads__note">The audio language is a must: a source marked as another language, or as MULTi, is never downloaded instead, and the download stops if none is found. Original files keep all included audio and subtitle tracks. Availability can vary by episode.</p>
        <div className="downloads__destination"><div><span>Save to</span><p title={directory}>{directory || 'Choose a folder on this device'}</p></div><FocusButton id="download-folder" disabled={!available} onSelect={() => { void chooseFolder(); }}>Choose folder</FocusButton></div>
        {!available && <p className="downloads__note">Open TVM Desktop, Chrome or Edge to choose where files are saved.</p>}
        {loading && <p role="status">Loading episodes…</p>}
        {series && !loading && episodes.length === 0 && <p role="status">No episodes are available to download yet.</p>}
        <FocusButton id="download-start" variant="primary" disabled={busy || !directory || count === 0 || loading} onSelect={() => { void enqueue(); }}>{busy ? 'Adding…' : `${count > 1 ? `Download ${count} episodes` : 'Download'} · ${LANGUAGE_LABELS[language] ?? language} · ${quality === '2160' ? '4K' : `${quality}p`}`}</FocusButton>
      </section>}
      {message && <p className="downloads__message" role="status">{message}</p>}
      <section className="downloads__queue" aria-label="Download queue"><div className="downloads__queue-heading"><h2>Your downloads</h2><span>{jobs.filter((job) => ACTIVE.has(job.state)).length} active</span></div>
        {jobs.length === 0 && <p className="downloads__empty">{id ? 'Your downloads will appear here.' : 'Open a film or series and choose Download to get started.'}</p>}
        {[...jobs].reverse().map((job) => <article key={job.id} className="download-job"><div className="download-job__info"><h3>{job.title}</h3><p>{job.state === 'downloading' ? `${size(job.bytes)}${job.total > 0 ? ` of ${size(job.total)}` : ''}` : job.state === 'resolving' ? 'Finding your file…' : job.state.charAt(0).toUpperCase() + job.state.slice(1)}{job.error ? ` · ${job.error}` : ''}</p>{job.path && <small>{job.path}</small>}
          {job.state === 'downloading' && <progress aria-label={`${job.title} download progress`} max={job.total || undefined} value={job.total > 0 ? job.bytes : undefined} />}</div>
          {ACTIVE.has(job.state) && <FocusButton id={`download-cancel-${job.id}`} variant="quiet" onSelect={() => { void bridge.cancel(job.id); }}>Cancel</FocusButton>}
          {job.state === 'complete' && window.tvmDownloads && <FocusButton id={`download-show-${job.id}`} variant="quiet" onSelect={() => { void bridge.show(job.id); }}>Show file</FocusButton>}
        </article>)}
      </section>
      <p className="downloads__note">Keep {window.tvmDownloads ? 'TVM open' : 'this tab open'} until downloads finish.</p>
    </div>
  </main>;
}
