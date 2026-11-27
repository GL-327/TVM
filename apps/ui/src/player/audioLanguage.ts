/**
 * The audio language a native player (VLC on iPhone, Media3 on Android) should start with. Same rule as Core's
 * preferredAudio: the Settings choice, else the title's original language, else English. Without it the player
 * keeps the file's default track, which in many multi-audio releases is a dub (often Russian).
 */
export function nativeAudioLanguage(setting: string | undefined, originalLanguage: string | null | undefined): string {
  const chosen = (setting ?? 'original').trim().toLowerCase();
  if (chosen !== '' && chosen !== 'original') return chosen;
  const original = (originalLanguage ?? '').trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(original) ? original : 'eng';
}
