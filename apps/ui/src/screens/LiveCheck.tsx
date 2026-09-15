import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { FocusButton } from '../components/FocusButton';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import {
  checkLiveChannels,
  fetchLastLiveCheck,
  fetchLive,
  type ChannelCheck,
  type LiveCheckSummary,
  type LiveStatus,
} from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './billing.css';
import './liveCheck.css';

/**
 * Answers "is Live TV actually working?" by opening real channels.
 *
 * A provider listing twenty thousand channels proves nothing on its own, and a
 * channel that fails to play gives the viewer no way to tell whose fault it
 * is. This runs the same fetch the player would and says, per channel, what
 * came back — so a dead channel is never mistaken for a broken setup.
 */

const LIMITS = [10, 25, 50] as const;

/** How each verdict reads to someone who just wants to know if it works. */
const VERDICT_LABEL: Record<ChannelCheck['verdict'], string> = {
  working: 'Streaming',
  unauthorized: 'Refused',
  missing: 'Gone',
  offline: 'Not on air',
  silent: 'Not on air',
  empty: 'No data',
  unplayable: 'Not video',
  unreachable: 'Unreachable',
};

function transportLabel(check: ChannelCheck): string {
  if (check.transport === 'mpegts') return 'MPEG-TS';
  if (check.transport === 'hls') return 'HLS';
  return '—';
}

export function LiveCheck({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [report, setReport] = useState<LiveCheckSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(LIMITS[1]);
  const [groupIndex, setGroupIndex] = useState(-1);
  const inFlight = useRef(false);

  const requestedGroup = typeof params['group'] === 'string' ? params['group'] : undefined;

  useEffect(() => {
    let cancelled = false;
    void fetchLive().then((live) => { if (!cancelled) setStatus(live); });
    // Show the previous sweep straight away rather than an empty screen.
    void fetchLastLiveCheck().then((last) => { if (!cancelled && last !== null) setReport(last); });
    return () => { cancelled = true; };
  }, []);

  const groups = status?.groups ?? [];
  const group = requestedGroup ?? (groupIndex >= 0 ? groups[groupIndex]?.name : undefined);

  const run = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    try {
      setReport(await checkLiveChannels({ limit, ...(group !== undefined ? { group } : {}) }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The channel check could not run.');
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  };

  const working = report?.results.filter((entry) => entry.ok) ?? [];
  const failing = report?.results.filter((entry) => !entry.ok) ?? [];

  return (
    <main className="page page--settings live-check">
      <PageScene />
      <Ribbon active="live" />

      <header className="page__toolbar">
        <div>
          <p className="stage__kicker">Live TV</p>
          <h1 className="page__heading">Channel check</h1>
        </div>
        <div className="hero__actions">
          <FocusButton id="run-check" variant="primary" disabled={running} onSelect={() => void run()}>
            {running ? 'Checking…' : 'Check channels now'}
          </FocusButton>
          <FocusButton id="check-back" className="tvm-button--glass" disabled={running} onSelect={() => navigate.pop()}>
            Back
          </FocusButton>
        </div>
      </header>

      <p className="page__lede">
        This opens each channel exactly as the player would and reports what came back,
        so a channel that is simply off air is never confused with a setup that is broken.
      </p>

      <section className="live-check__controls">
        <FocusButton
          id="check-limit"
          className="billing-option"
          disabled={running}
          detail={`Checking ${limit} channels · a sweep takes about ${Math.ceil((limit * 2.5) / 60)} min`}
          onSelect={() => setLimit(LIMITS[(LIMITS.indexOf(limit as (typeof LIMITS)[number]) + 1) % LIMITS.length]!)}
        >
          How many · change
        </FocusButton>
        {requestedGroup === undefined && groups.length > 0 && (
          <FocusButton
            id="check-group"
            className="billing-option"
            disabled={running}
            detail={group ?? 'Your chosen channels, or the whole list'}
            onSelect={() => setGroupIndex((index) => (index + 2 > groups.length ? -1 : index + 1))}
          >
            Which channels · change
          </FocusButton>
        )}
      </section>

      {error !== null && <p className="billing-message billing-message--error" role="alert">{error}</p>}

      {running && (
        <p className="live-check__running" role="status">
          Opening {limit} channels{group === undefined ? '' : ` from ${group}`}. This fetches real video, so it is not instant.
        </p>
      )}

      {report !== null && !running && (
        <>
          <section className={`live-check__verdict${report.working > 0 ? ' live-check__verdict--ok' : ' live-check__verdict--bad'}`} role="status">
            <p className="live-check__verdict-line">{report.verdict}</p>
            <dl className="live-check__counts">
              <div><dt>Streaming</dt><dd>{report.working}</dd></div>
              <div><dt>Checked</dt><dd>{report.checked}</dd></div>
              <div><dt>In the list</dt><dd>{report.total.toLocaleString()}</dd></div>
            </dl>
          </section>

          {working.length > 0 && (
            <section className="live-check__group">
              <h2>Channels you can watch right now ({working.length})</h2>
              <ul className="live-check__list">
                {working.map((entry) => (
                  <li key={entry.id} className="live-check__row live-check__row--ok">
                    <span className="live-check__tick" aria-hidden="true">✓</span>
                    <span className="live-check__name">{entry.name}</span>
                    <span className="live-check__meta">{transportLabel(entry)} · {entry.ms} ms</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {failing.length > 0 && (
            <section className="live-check__group">
              <h2>Not available ({failing.length})</h2>
              <ul className="live-check__list">
                {failing.map((entry) => (
                  <li key={entry.id} className="live-check__row">
                    <span className="live-check__tick" aria-hidden="true">·</span>
                    <span className="live-check__name">{entry.name}</span>
                    <span className="live-check__meta">{VERDICT_LABEL[entry.verdict]}</span>
                    <span className="live-check__detail">{entry.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {report === null && !running && error === null && (
        <EmptyState
          title="No channels checked yet"
          body="Run a check to see which of your channels actually stream."
        />
      )}
    </main>
  );
}
