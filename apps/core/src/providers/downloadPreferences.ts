/**
 * The audio languages a download can ask for, as the words and country flags
 * release names use for them. Torrentio flags only the languages that are not
 * English, so an unmarked release counts as English.
 */
export const DOWNLOAD_LANGUAGES = {
  en: { words: ['english', 'eng'], flags: ['GB', 'US', 'AU', 'NZ', 'IE'] },
  ja: { words: ['japanese', 'jpn', 'jap'], flags: ['JP'] },
  fr: { words: ['french', 'fre', 'fra', 'vff', 'vfq', 'vf2', 'vfi', 'truefrench'], flags: ['FR'] },
  de: { words: ['german', 'ger', 'deu'], flags: ['DE', 'AT'] },
  es: { words: ['spanish', 'spa', 'castellano', 'latino', 'esp'], flags: ['ES', 'MX', 'AR'] },
  it: { words: ['italian', 'ita'], flags: ['IT'] },
  pt: { words: ['portuguese', 'por', 'ptbr', 'dublado'], flags: ['PT', 'BR'] },
  ko: { words: ['korean', 'kor'], flags: ['KR'] },
  hi: { words: ['hindi', 'hin'], flags: ['IN'] },
} as const;

/** Languages that are never offered but still mark a release as not the one asked for. */
const OTHER_LANGUAGES = [
  { words: ['russian', 'rus'], flags: ['RU'] },
  { words: ['ukrainian', 'ukr'], flags: ['UA'] },
  { words: ['polish', 'pol', 'lektor'], flags: ['PL'] },
  { words: ['chinese', 'chi', 'mandarin'], flags: ['CN', 'TW', 'HK'] },
  { words: ['arabic', 'ara'], flags: ['SA', 'AE', 'EG'] },
  { words: ['turkish', 'tur'], flags: ['TR'] },
  { words: ['dutch', 'dut'], flags: ['NL', 'BE'] },
  { words: ['swedish', 'swe'], flags: ['SE'] },
  { words: ['thai', 'tha'], flags: ['TH'] },
] as const;

export interface DownloadPreferences { language: string; maxHeight: number }

export function validDownloadPreferences(value: unknown): value is DownloadPreferences {
  if (value === null || typeof value !== 'object') return false;
  const prefs = value as DownloadPreferences;
  return (prefs.language === 'original' || Object.hasOwn(DOWNLOAD_LANGUAGES, prefs.language)) &&
    [480, 720, 1080, 2160].includes(prefs.maxHeight);
}

/** The country flags in a name, each pair of regional indicator letters as its two capitals. */
function flagsIn(text: string): string[] {
  return [...text.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)].map((match) =>
    [...match[0]].map((letter) => String.fromCharCode(65 + letter.codePointAt(0)! - 0x1f1e6)).join(''));
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z])${word}(?:[^a-z]|$)`, 'i').test(text);
}

/**
 * How well a release fits a language: 0 when it is that language alone, 1 when
 * it carries it beside others, -1 when it is another language. A MULTi or
 * dual-audio release counts as several languages, since its first track is
 * often a dub.
 */
export function languageFit(label: string, language: string): number {
  if (language === 'original') return 0;
  const audio = label.match(/(?:audio|languages?)\s*:\s*([^\n]+)/i)?.[1];
  const source = (audio ?? label.split('\n').filter((line) => !/^\s*(?:subtitles?|subs?|captions?)\s*:/i.test(line)).join('\n'))
    // Subtitles say nothing about the audio.
    .replace(/\bmulti[ ._-]?subs?\b/gi, 'subs')
    .replace(/\b(?:english|eng|japanese|jpn|french|fre|german|ger|spanish|spa)[ ._-]*(?:subs?|subtitles?)\b/gi, '');
  const flags = flagsIn(source);
  const speaks = (marks: { words: readonly string[]; flags: readonly string[] }): boolean =>
    marks.words.some((word) => hasWord(source, word)) || marks.flags.some((flag) => flags.includes(flag));
  let wanted = false;
  let other = false;
  for (const [code, marks] of Object.entries(DOWNLOAD_LANGUAGES)) {
    if (!speaks(marks)) continue;
    if (code === language) wanted = true;
    else other = true;
  }
  if (OTHER_LANGUAGES.some(speaks)) other = true;
  const known = new Set<string>([...Object.values(DOWNLOAD_LANGUAGES), ...OTHER_LANGUAGES].flatMap((marks) => [...marks.flags]));
  if (flags.some((flag) => !known.has(flag))) other = true;
  if (hasWord(source, 'multi') || hasWord(source, 'dual')) other = true;
  if (language === 'en' && !other) return 0;
  if (wanted && !other) return 0;
  return wanted ? 1 : -1;
}

/**
 * Never silently replace a requested language with a different release. Only a
 * release in that language alone is taken: a multilingual file that also has
 * it can still open on another track.
 */
export function downloadLanguageMatches(label: string, language: string): boolean {
  return languageFit(label, language) === 0;
}
