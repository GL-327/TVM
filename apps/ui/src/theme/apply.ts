import { resolveTheme, type ThemeId } from './registry';

import './default.css';
import './happy.css';
import './light.css';
import './dark.css';
import './sunset.css';
import './heather.css';
import './scene.css';
import './glass/tokens.css';
import './glass/home.css';
import './glass/cards.css';
import './glass/ribbon.css';
import './glass/player.css';
import './glass/apps.css';
import './glass/search.css';
import './glass/settings.css';
import './glass/motion.css';
import './glass/kit.css';
import.meta.glob('./glass/*.css', { eager: true });
import './synthwave.css';

export const THEME_STORAGE_KEY = 'tvm.theme';
const THEME_DEFAULT_BOOT = 'tvm.theme.isle-boot';
const themeListeners = new Set<(id: ThemeId) => void>();

export function subscribeTheme(listener: (id: ThemeId) => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readStoredTheme(): ThemeId {
  return resolveTheme(storage()?.getItem(THEME_STORAGE_KEY));
}

export function applyTheme(id: ThemeId | string): ThemeId {
  const theme = resolveTheme(id);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
  try {
    storage()?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // private mode / quota — attribute still applies for this session
  }
  for (const listener of themeListeners) {
    try {
      listener(theme);
    } catch {
      // a bad subscriber must not strand the rest
    }
  }
  return theme;
}

export function applyStoredTheme(): ThemeId {
  const store = storage();
  if (store !== null && store.getItem(THEME_DEFAULT_BOOT) !== '1') {
    try {
      store.setItem(THEME_DEFAULT_BOOT, '1');
    } catch {
      // private mode — still apply for this session
    }
    return applyTheme('default');
  }
  return applyTheme(readStoredTheme());
}
