import { useCallback, useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { fieldValue, FocusField } from '../components/FocusField';
import { TopBar } from '../components/TopBar';
import { fetchLive, saveLivePlaylist, type LiveStatus } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const EMPTY: LiveStatus = { url: null, channels: [], error: null };

function looksLikeText(value: string): boolean {
  const trimmed = value.trim();
  return /^#EXTM3U/i.test(trimmed) || /#EXTINF:/i.test(trimmed) || (trimmed.includes('\n') && /https?:\/\//i.test(trimmed));
}

function playlistLabel(status: LiveStatus): string {
  if (status.url === 'local:playlist') return 'Pasted on this machine';
  if (status.url === null) return 'Not added';
  return status.url;
}

export function LivePlaylist(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LiveStatus>(EMPTY);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await fetchLive();
    if (next === null) return;
    setStatus(next);
    if (next.url !== null && next.url !== 'local:playlist') setUrl(next.url);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMessage('Core did not answer.'));
  }, [refresh]);

  const save = async (): Promise<void> => {
    const nextUrl = (fieldValue('url') || url).trim();
    const nextText = (fieldValue('playlist-text') || text).trim();
    setBusy(true);
    setMessage(null);
    try {
      const body = await saveLivePlaylist(
        nextText !== '' && looksLikeText(nextText) ? { text: nextText } : { url: nextUrl },
      );
      setStatus(body);
      if (body.url !== null && body.url !== 'local:playlist') setUrl(body.url);
      if (body.error === 'invalid') setMessage('That is not a usable M3U or M3U8 playlist. Paste an http(s) URL, a single .m3u8 stream, or the playlist text itself.');
      else if (body.error === 'unreachable') setMessage('TVM could not fetch that playlist. Check the address and the network.');
      else if (body.url === null) setMessage('Playlist removed.');
      else {
        const count = body.total ?? body.channels.length;
        setMessage(`${count} channels ready. Choose the ones you watch.`);
        if (count > 0) navigate.push('live-picks');
      }
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
      <h1 className="page__heading">Add a playlist</h1>
      <p className="page__lede">
        Paste an M3U or M3U8 URL you are allowed to use — a tuner, Plex, Jellyfin, or TVHeadend in your home — or a
        single .m3u8 stream. You can also paste the playlist text. TVM does not log into IPTV provider panels.
      </p>
      <dl className="panel__rows settings-summary">
        <div className="panel__row">
          <dt>Playlist</dt>
          <dd className="playlist-url">{playlistLabel(status)}</dd>
        </div>
        <div className="panel__row">
          <dt>Channels</dt>
          <dd>{status.total ?? status.channels.length}</dd>
        </div>
      </dl>
      {message !== null && <p className="page__message">{message}</p>}
      <label className="token-field">
        <span>Playlist or stream URL</span>
        <FocusField
          id="url"
          type="url"
          value={url}
          onChange={setUrl}
          onConfirm={() => void save()}
          afterPasteFocusId="save"
          placeholder="https://…/playlist.m3u8"
        />
      </label>
      <label className="token-field">
        <span>Or paste playlist text</span>
        <FocusField
          id="playlist-text"
          value={text}
          onChange={setText}
          onConfirm={() => void save()}
          afterPasteFocusId="save"
          multiline
          placeholder="#EXTM3U"
        />
      </label>
      <div className="hero__actions">
        <FocusButton id="save" variant="primary" disabled={busy} onSelect={() => void save()}>
          {busy ? 'Saving…' : 'Save playlist'}
        </FocusButton>
        <FocusButton id="choose-channels" onSelect={() => navigate.push('live-picks')}>
          Choose channels
        </FocusButton>
        <FocusButton id="open-live" onSelect={() => navigate.push('live')}>
          Open Live TV
        </FocusButton>
        <FocusButton
          id="clear-playlist"
          disabled={busy}
          onSelect={() => {
            setUrl('');
            setText('');
            void saveLivePlaylist('').then((body) => {
              setStatus(body);
              setMessage('Playlist removed.');
            });
          }}
        >
          Remove
        </FocusButton>
        <FocusButton id="back" onSelect={() => navigate.pop()}>
          Back
        </FocusButton>
      </div>
    </main>
  );
}
