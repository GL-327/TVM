export const DOWNLOAD_LANGUAGES = {
  en: /\b(english|eng)\b|🇬🇧|🇺🇸/i,
  ja: /\b(japanese|jpn|jap)\b|🇯🇵/i,
  fr: /\b(french|fre|fra|vff|vfq)\b|🇫🇷/i,
  de: /\b(german|ger|deu)\b|🇩🇪/i,
  es: /\b(spanish|spa|castellano|latino)\b|🇪🇸|🇲🇽/i,
  it: /\b(italian|ita)\b|🇮🇹/i,
  pt: /\b(portuguese|por|ptbr)\b|🇵🇹|🇧🇷/i,
  ko: /\b(korean|kor)\b|🇰🇷/i,
  hi: /\b(hindi|hin)\b|🇮🇳/i,
} as const;

export interface DownloadPreferences { language: string; maxHeight: number }

export function validDownloadPreferences(value: unknown): value is DownloadPreferences {
  if (value === null || typeof value !== 'object') return false;
  const prefs = value as DownloadPreferences;
  return (prefs.language === 'original' || Object.hasOwn(DOWNLOAD_LANGUAGES, prefs.language)) &&
    [480, 720, 1080, 2160].includes(prefs.maxHeight);
}

/** Never silently replace a requested language with a different release. */
export function downloadLanguageMatches(label: string, language: string): boolean {
  if (language === 'original') return true;
  const audio = label.match(/(?:audio|languages?)\s*:\s*([^\n]+)/i)?.[1];
  const source = audio ?? label.split('\n').filter((line) => !/^\s*(?:subtitles?|subs?|captions?)\s*:/i.test(line)).join('\n')
    .replace(/\b(?:english|eng|japanese|jpn|french|fre|german|ger|spanish|spa)[ ._-]*(?:subs?|subtitles?)\b/gi, '');
  return DOWNLOAD_LANGUAGES[language as keyof typeof DOWNLOAD_LANGUAGES]?.test(source) ?? false;
}
