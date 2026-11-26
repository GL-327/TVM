export const EXTRA_OPTIONS = [
  ['onlineSubtitles', true, 'Online subtitles', 'Find additional tracks through OpenSubtitles.'],
  ['trailers', true, 'Trailers', 'Watch trailers inside TVM.'],
  ['trailerBackdrops', true, 'Trailer backdrops', 'Play a muted trailer on the Details page.', 'Desktop and web'],
  ['collections', true, 'Collections', 'Show related films on Details.'],
  ['comingUp', true, 'Coming up', 'Show upcoming episodes on Home and Details.'],
  ['watchStats', true, 'Watch stats', 'Record watch history and show your viewing stats.'],
  ['animeTitles', true, 'English anime titles', 'Show English titles from AniList when available.'],
  ['ratings', true, 'IMDb ratings', 'Show IMDb scores on Home and Details.'],
  ['qualityBadges', true, 'Quality badges', 'Show resolution, HDR and Atmos where known.'],
  ['versionPicker', true, 'Version picker', 'Choose a source on Details or during playback.'],
  ['chapters', true, 'Chapters', 'Chapter markers depend on metadata provided by the video source.'],
  ['seekPreviews', true, 'Seek previews', 'Show a thumbnail while scrubbing.', 'Native mpv only'],
  ['themeSongs', false, 'Theme songs', 'Play a theme quietly on Details.', 'Desktop and web'],
  ['spoilerBlur', false, 'Spoiler blur', 'Hide stills and summaries for unwatched episodes.'],
  ['surpriseMe', true, 'Surprise me', 'Pick something to watch from recommendations and My List.'],
  ['autoCollections', true, 'Automatic collections', 'Group recommendations into extra rows on Home.'],
  ['sleepTimer', true, 'Sleep timer', 'Stop playback after a set time or at the end of an episode.'],
  ['nightMode', false, 'Night mode', 'Reduce the difference between quiet and loud sounds.'],
  ['pauseOnMinimize', true, 'Pause when hidden', 'Pause when the window is hidden or minimised.', 'Desktop and web'],
  ['shortcutsOverlay', true, 'Keyboard shortcuts', 'Press ? in the player to see shortcuts.', 'Desktop and web'],
  ['webhook', false, 'Playback webhook', 'Send play, pause, stop and finish events to your URL.'],
  ['announcements', true, 'Announcements', 'Show announcements from TVM on Home.'],
  ['franchiseIntros', true, 'Franchise intros', 'Play a short animated intro when a Hunger Games or Marvel film starts.'],
] as const;

export type ExtraId = typeof EXTRA_OPTIONS[number][0];
export type SleepTimer = 'off' | '15' | '30' | '45' | '60' | 'end';
export interface SubtitleStyle {
  size: 's' | 'm' | 'l' | 'xl';
  color: 'white' | 'yellow' | 'cyan';
  background: 'shadow' | 'box' | 'none';
}
export interface PolishPrefs {
  quality: 'original' | '2160' | '1080' | '720' | 'saver';
  audioLanguage: string;
  skipUpscaled: boolean;
  subtitleMode: 'off' | 'foreign' | 'always';
  subtitleStyle: SubtitleStyle;
  extras: Partial<Record<ExtraId, boolean>>;
  webhookUrl: string | null;
  homeSections: { id: string; visible: boolean }[];
  volumeBoostMax: number;
  sleepTimerDefault: SleepTimer;
  spotlightEvents: boolean;
  posterTitles: boolean;
}

const defaults: PolishPrefs = {
  quality: 'original',
  audioLanguage: 'original',
  skipUpscaled: true,
  subtitleMode: 'foreign',
  subtitleStyle: { size: 'm', color: 'white', background: 'shadow' },
  extras: Object.fromEntries(EXTRA_OPTIONS.map(([id, enabled]) => [id, enabled])),
  webhookUrl: null,
  homeSections: [],
  volumeBoostMax: 200,
  sleepTimerDefault: 'off',
  spotlightEvents: true,
  posterTitles: true,
};
const key = 'tvm.polishPrefs';
let remoteFlags: Record<string, boolean> = {};

export function mergePolishPrefs(current: PolishPrefs, patch: Partial<PolishPrefs>): PolishPrefs {
  const next = { ...current, ...patch };
  next.extras = { ...current.extras, ...patch.extras };
  next.subtitleStyle = { ...current.subtitleStyle, ...patch.subtitleStyle };
  return next;
}

export function readPolishPrefs(): PolishPrefs {
  try {
    return mergePolishPrefs(defaults, JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<PolishPrefs>);
  } catch {
    return defaults;
  }
}

export function storePolishPrefs(prefs: PolishPrefs): void {
  const { quality, audioLanguage, skipUpscaled, subtitleMode, subtitleStyle, extras, webhookUrl, homeSections,
    volumeBoostMax, sleepTimerDefault, spotlightEvents, posterTitles } = prefs;
  try {
    localStorage.setItem(key, JSON.stringify({ quality, audioLanguage, skipUpscaled, subtitleMode, subtitleStyle,
      extras, webhookUrl, homeSections, volumeBoostMax, sleepTimerDefault, spotlightEvents, posterTitles }));
  } catch {
    // Storage can be disabled in private windows.
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.posterTitles = posterTitles ? 'on' : 'off';
}

export function applyRemoteFlags(flags: Record<string, boolean>): void {
  remoteFlags = flags;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('tvm:extra-flags'));
}

export function extraEnabled(id: ExtraId, prefs = readPolishPrefs()): boolean {
  return remoteFlags[id] !== false && prefs.extras[id] !== false;
}

export function isExtraAllowed(id: ExtraId): boolean {
  return remoteFlags[id] !== false;
}
