import { useEffect, useState } from 'react';
import { extraEnabled, isExtraAllowed, type ExtraId, type PolishPrefs } from './polishPrefs';
import { PREFS_CHANGED_EVENT, readPrefs } from './prefs';

export const EXTRA_FLAGS_EVENT = 'tvm:extra-flags';

export function isPhoneApp(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /TVM-iOS|TVM-Android/i.test(userAgent);
}

export function uiExtraEnabled(id: ExtraId, prefs: PolishPrefs, phone = isPhoneApp()): boolean {
  if (phone && ['pauseOnMinimize', 'shortcutsOverlay', 'trailerBackdrops', 'themeSongs'].includes(id)) return false;
  return isExtraAllowed(id) && extraEnabled(id, prefs);
}

export function episodeIsWatched(episode: { watched?: boolean; progress?: number }): boolean {
  return episode.watched === true || (episode.watched !== false && (episode.progress ?? 0) > 0.96);
}

export function useExtraPrefs(): ReturnType<typeof readPrefs> {
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => {
    const sync = (): void => setPrefs(readPrefs());
    window.addEventListener(PREFS_CHANGED_EVENT, sync);
    window.addEventListener(EXTRA_FLAGS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREFS_CHANGED_EVENT, sync);
      window.removeEventListener(EXTRA_FLAGS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return prefs;
}
