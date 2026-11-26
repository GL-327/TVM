import { useState, type ReactNode } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { FocusButton } from '../components/FocusButton';
import { Switch } from '../components/Switch';
import { GlassSegmented, type SegmentedOption } from '../components/GlassSegmented';
import { useScopedFocusKey } from '../nav/ViewStackContext';
import type { AppPrefs } from '../data/prefs';
import { SUBTITLE_LANGUAGE_OPTIONS, subtitleLanguageDisplayName } from '../data/prefs';
import { extraEnabled, isExtraAllowed, EXTRA_OPTIONS, type SleepTimer, type SubtitleStyle } from '../data/polishPrefs';

export type SettingsRow = { id: string; title: string; detail: string; control: ReactNode };
export const QUALITY = [
  { id: 'original', label: 'Original – best available' }, { id: '2160', label: '4K' },
  { id: '1080', label: '1080p' }, { id: '720', label: '720p' }, { id: 'saver', label: 'Data saver' },
] as const;
export const SLEEP: readonly SegmentedOption<SleepTimer>[] = [
  { id: 'off', label: 'Off' }, { id: '15', label: '15 minutes' }, { id: '30', label: '30 minutes' },
  { id: '45', label: '45 minutes' }, { id: '60', label: '60 minutes' }, { id: 'end', label: 'End of episode' },
];
const languageOptions = SUBTITLE_LANGUAGE_OPTIONS.map(({ code, label }) => ({ id: code, label }));
type Save = (patch: Partial<AppPrefs>) => void;

export function Choice<T extends string>({ id, label, options, value, onChange }: {
  id: string; label: string; options: readonly SegmentedOption<T>[]; value: T; onChange: (value: T) => void;
}): React.JSX.Element {
  const { ref } = useFocusable<object, HTMLSelectElement>({ focusKey: useScopedFocusKey(id) });
  return <select ref={ref} data-focus-id={id} className="polish-select" aria-label={label}
    value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
    {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
  </select>;
}

export function toggle(id: string, title: string, detail: string, checked: boolean, onChange: (value: boolean) => void): SettingsRow {
  return { id, title, detail, control: <Switch id={id} label={title} checked={checked} onChange={onChange} /> };
}

export function select<T extends string>(id: string, title: string, detail: string,
  value: T, options: readonly SegmentedOption<T>[], onChange: (value: T) => void): SettingsRow {
  return { id, title, detail, control: <Choice id={id} label={title} value={value} options={options} onChange={onChange} /> };
}

export function segment<T extends string>(id: string, title: string, detail: string,
  value: T, options: readonly SegmentedOption<T>[], onChange: (value: T) => void): SettingsRow {
  return { id, title, detail, control: <GlassSegmented idPrefix={id} ariaLabel={title} value={value}
    options={options} onChange={onChange} /> };
}

export function action(id: string, title: string, detail: string, onSelect: () => void, label = 'Open'): SettingsRow {
  return { id, title, detail, control: <FocusButton id={id} tabIndex={0} className="settings-open"
    ariaLabel={title} onSelect={onSelect}>{label}<span aria-hidden="true">›</span></FocusButton> };
}

export function playbackRows(prefs: AppPrefs, save: Save): SettingsRow[] {
  return [
    select('quality', 'Quality', 'Set the highest resolution TVM should play.', prefs.quality, QUALITY, (quality) => save({ quality })),
    toggle('skip-upscaled', 'Skip upscaled releases', 'Prefer versions mastered at their listed resolution.', prefs.skipUpscaled, (skipUpscaled) => save({ skipUpscaled })),
    select('audio-language', 'Audio language', 'Choose the audio track used when playback starts.', prefs.audioLanguage,
      [{ id: 'original', label: 'Original language' }, ...languageOptions], (audioLanguage) => save({ audioLanguage })),
    toggle('autoplay-next', 'Autoplay next episode', 'Start the next episode after the countdown.', prefs.autoplayNext, (autoplayNext) => save({ autoplayNext })),
    segment('skip-segments', 'Skip intro & credits', 'Includes recaps when a skip point is available.', prefs.skipSegments,
      [{ id: 'off', label: 'Off' }, { id: 'button', label: 'Button' }, { id: 'auto', label: 'Automatic' }],
      (skipSegments) => save({ skipSegments })),
    { id: 'volume-boost', title: 'Volume boost max', detail: 'Limit how far the player volume can be boosted.',
      control: <label className="settings-range"><input type="range" min="100" max="300" step="10"
        aria-label="Volume boost max" value={prefs.volumeBoostMax}
        onChange={(event) => save({ volumeBoostMax: event.currentTarget.valueAsNumber })} /><span>{prefs.volumeBoostMax}%</span></label> },
    select('sleep-default', 'Sleep timer default', 'Start each video with this timer.', prefs.sleepTimerDefault, SLEEP,
      (sleepTimerDefault) => save({ sleepTimerDefault })),
  ];
}

function Languages({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }): React.JSX.Element {
  const remaining = languageOptions.filter((option) => !value.includes(option.id));
  return <div className="settings-languages">
    {value.map((code, index) => <div key={code}>
      <span>{index + 1}. {subtitleLanguageDisplayName(code)}</span>
      <button type="button" disabled={index === 0} aria-label={'Move ' + subtitleLanguageDisplayName(code) + ' up'}
        onClick={() => { const next = [...value]; next.splice(index - 1, 2, code, next[index - 1]!); onChange(next); }}>↑</button>
      <button type="button" disabled={value.length === 1} aria-label={'Remove ' + subtitleLanguageDisplayName(code)}
        onClick={() => onChange(value.filter((entry) => entry !== code))}>×</button>
    </div>)}
    {remaining.length > 0 && <Choice id="subtitle-add" label="Add subtitle language" value=""
      options={[{ id: '', label: 'Add language' }, ...remaining]} onChange={(code) => { if (code) onChange([...value, code]); }} />}
  </div>;
}

export function audioRows(prefs: AppPrefs, save: Save): SettingsRow[] {
  const style = <K extends keyof SubtitleStyle>(key: K, value: SubtitleStyle[K]): void =>
    save({ subtitleStyle: { ...prefs.subtitleStyle, [key]: value } });
  return [
    select('subtitle-mode', 'Subtitle mode', 'Choose when captions appear by default.', prefs.subtitleMode,
      [{ id: 'off', label: 'Off' }, { id: 'foreign', label: 'Foreign audio only' }, { id: 'always', label: 'Always' }],
      (subtitleMode) => save({ subtitleMode })),
    { id: 'subtitle-languages', title: 'Preferred subtitle languages', detail: 'TVM tries these languages in order.',
      control: <Languages value={prefs.subtitleLanguages} onChange={(subtitleLanguages) => save({ subtitleLanguages })} /> },
    select('subtitle-size', 'Size', 'Subtitle text size.', prefs.subtitleStyle.size,
      [{ id: 's', label: 'Small' }, { id: 'm', label: 'Medium' }, { id: 'l', label: 'Large' }, { id: 'xl', label: 'Extra large' }], (value) => style('size', value)),
    select('subtitle-color', 'Colour', 'Subtitle text colour.', prefs.subtitleStyle.color,
      [{ id: 'white', label: 'White' }, { id: 'yellow', label: 'Yellow' }, { id: 'cyan', label: 'Cyan' }], (value) => style('color', value)),
    select('subtitle-back', 'Background', 'Change how subtitle text stands out from the picture.', prefs.subtitleStyle.background,
      [{ id: 'shadow', label: 'Shadow' }, { id: 'box', label: 'Box' }, { id: 'none', label: 'None' }], (value) => style('background', value)),
    { id: 'subtitle-preview', title: 'Preview', detail: 'See how your subtitles will look.',
      control: <div className="settings-subtitle-preview"><span style={subtitlePreviewStyle(prefs.subtitleStyle)}>A quiet evening.</span></div> },
    toggle('audio-night', 'Night mode', 'Reduce loud peaks in the player.', extraEnabled('nightMode', prefs), (nightMode) => save({ extras: { nightMode } })),
  ];
}

export function subtitlePreviewStyle(style: SubtitleStyle): React.CSSProperties {
  return {
    fontSize: { s: '.8rem', m: '1rem', l: '1.25rem', xl: '1.5rem' }[style.size],
    color: style.color, background: style.background === 'box' ? '#07080b' : undefined,
    textShadow: style.background === 'shadow' ? '0 1px 3px #000, 0 0 4px #000' : undefined,
  };
}

function Webhook({ url, onSave }: { url: string | null; onSave: (url: string | null) => void }): React.JSX.Element {
  const [value, setValue] = useState(url ?? '');
  return <form className="settings-webhook" onSubmit={(event) => { event.preventDefault(); onSave(value.trim() || null); }}>
    <input type="url" className="polish-field" aria-label="Webhook URL" placeholder="https://…" value={value}
      onChange={(event) => setValue(event.currentTarget.value)} />
    <button type="submit">Save</button>
  </form>;
}

export function extraRows(prefs: AppPrefs, save: Save): SettingsRow[] {
  const phoneApp = /TVM-iOS|TVM-Android/.test(navigator.userAgent);
  // Seek previews need a second mpv, which only the Windows app has, so this UI never offers it.
  const rows = EXTRA_OPTIONS.filter(([id]) => isExtraAllowed(id) && id !== 'seekPreviews' &&
    (!phoneApp || !['trailerBackdrops', 'themeSongs', 'pauseOnMinimize', 'shortcutsOverlay'].includes(id)))
    .map(([id, , name, detail, platform]) =>
      toggle('extra-' + id, name, platform ? detail + ' ' + platform + '.' : detail, extraEnabled(id, prefs),
        (value) => save({ extras: { [id]: value } })));
  if (extraEnabled('webhook', prefs)) rows.push({ id: 'webhook-url', title: 'Webhook URL', detail: 'Where Core sends playback events.',
    control: <Webhook url={prefs.webhookUrl} onSave={(webhookUrl) => save({ webhookUrl })} /> });
  return rows;
}
