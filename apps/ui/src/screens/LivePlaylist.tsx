import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { fetchLive, saveLivePlaylist, type LiveStatus } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: LiveStatus = { url: null, channels: [], error: null };

export function LivePlaylist(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LiveStatus>(EMPTY);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await fetchLive();
    if (next !== null) setStatus(next);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMessage('Core did not answer.'));
  }, [refresh]);

  const save = async (raw?: string): Promise<void> => {
    const next = (raw ?? url).trim();
    setBusy(true);
    setMessage(null);
    try {
      const body = await saveLivePlaylist(next);
      setStatus(body);
      setUrl('');
      if (body.error === 'invalid') setMessage('That address is not a usable M3U or M3U8 playlist.');
      else if (body.error === 'unreachable') setMessage('TVM could not fetch that playlist.');
      else if (body.url === null) setMessage('Playlist removed.');
      else setMessage(`${body.channels.length} channels ready in Live TV.`);
    } catch {
      setMessage('The playlist was not stored.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--settings">
      <TopBar title="Live TV playlist" />
      <p className="stage__kicker">Your source</p>
      <h1 className="page__heading">Live TV playlist</h1>
      <p className="page__lede">
        Paste an M3U or M3U8 URL you are allowed to use. TVM stores the address on this machine and does not scrape
        BBC, sports, or any other channel.
      </p>
      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>Playlist</dt>
          <dd>{status.url === null ? 'Not added' : 'Saved on this machine'}</dd>
        </div>
        <div className="panel__row">
          <dt>Channels</dt>
          <dd>{status.channels.length}</dd>
        </div>
      </dl>
      {message !== null && <p className="page__message">{message}</p>}
      <label className="token-field">
        <span>M3U or M3U8 URL</span>
        <FocusField
          id="url"
          type="url"
          value={url}
          onChange={setUrl}
          onConfirm={(value) => void save(value)}
          afterPasteFocusId="save"
          placeholder="Paste URL, then press OK"
        />
      </label>
      <div className="hero__actions">
        <FocusButton id="save" variant="primary" disabled={busy} onSelect={() => void save(fieldValue('url'))}>
          {busy ? 'Saving…' : 'Save playlist'}
        </FocusButton>
        <FocusButton id="open-live" onSelect={() => navigate.push('live')}>
          Open Live TV
        </FocusButton>
        <FocusButton id="back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
