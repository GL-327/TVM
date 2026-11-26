import { useEffect, useState } from 'react';
import { chooseVersion, chosenVersion, fetchPlaybackVersions, playbackKey, type PlaybackIdentity, type Version } from '../data/playbackVersions';
import '../player/playback-extras.css';

export function useVersions(identity: PlaybackIdentity, enabled: boolean): Version[] {
  const [result, setResult] = useState<{ key: string; versions: Version[] }>({ key: '', versions: [] });
  const key = playbackKey(identity);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchPlaybackVersions(identity, controller.signal).then((versions) => {
      if (!controller.signal.aborted) setResult({ key, versions });
    });
    return () => controller.abort();
  }, [enabled, key]);
  return enabled && result.key === key ? result.versions : [];
}

export function VersionSelect({ identity, versions, onChange }: {
  identity: PlaybackIdentity; versions: readonly Version[]; onChange?: (id: string) => void;
}): React.JSX.Element | null {
  const [choice, setChoice] = useState(chosenVersion(identity) ?? '');
  useEffect(() => setChoice(chosenVersion(identity) ?? ''), [playbackKey(identity)]);
  if (!versions.length) return null;
  return <label className="extras-select">Version
    <select aria-label="Version" onKeyDown={(event) => event.stopPropagation()} value={versions.some((v) => v.id === choice) ? choice : ''} onChange={(event) => {
      const id = event.target.value;
      chooseVersion(identity, id || undefined);
      setChoice(id);
      onChange?.(id);
    }}>
      <option value="">Recommended · {versions[0]?.label}</option>
      {versions.map((version) => <option key={version.id} value={version.id}>{version.label}{version.recommended ? ' · Recommended' : ''}</option>)}
    </select>
  </label>;
}
