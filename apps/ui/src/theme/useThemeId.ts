import { useEffect, useState } from 'react';
import { readStoredTheme, subscribeTheme } from './apply';
import { resolveTheme, type ThemeId } from './registry';

export function readThemeId(): ThemeId {
  if (typeof document !== 'undefined') {
    return resolveTheme(document.documentElement.dataset.theme || readStoredTheme());
  }
  return readStoredTheme();
}

export function useThemeId(): ThemeId {
  const [theme, setTheme] = useState<ThemeId>(readThemeId);
  useEffect(() => {
    setTheme(readThemeId());
    return subscribeTheme(setTheme);
  }, []);
  return theme;
}
