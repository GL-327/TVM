import { useSyncExternalStore } from 'react';
import { isMobileClient } from '../../data/mobileAccess';
export type AnimePlatform = 'pc' | 'mobile' | 'roku';
export interface AnimeScene { id: string; title: string; summary: string; platforms: Record<AnimePlatform, string>; effects: string[]; hook: string; }
const modes = { pc: 'Layered tableau and pointer response', mobile: 'Still tableau, fewer particles, touch and focus response', roku: 'Slow ident and D-pad focus response' };
const scene = (id: string, title: string, summary: string, effects: string[], hook: string): AnimeScene => ({ id, title, summary, effects, hook, platforms: modes });
export const ANIME_SCENES: readonly AnimeScene[] = [
  scene('gojo-six-eyes', 'Six Eyes', 'An electric gaze across an infinite midnight.', ['eyes', 'infinity'], 'Gaze follows your pointer or focused tile'),
  scene('mahoraga', 'Adaptation', 'The wheel remembers every completed watch.', ['wheel', 'armour'], 'Completed watches turn the wheel and refresh Adapted for you'),
  scene('invincible-thragg-gojo', 'Unstoppable / Untouchable', 'A conqueror’s blow suspended at infinity.', ['duel', 'infinity'], 'Focus compresses the impact barrier'),
  scene('dress-up-fireworks', 'Summer, after dark', 'Two silhouettes beneath a sky full of wishes.', ['couple', 'fireworks'], 'Selecting a title releases a wish into the sky'),
  scene('mega-fight', 'Worlds collide', 'Five fighters. One impossible horizon.', ['brawl', 'speedlines'], 'Focus charges each fighter in sequence'),
  scene('just-this-once', 'Just this once', 'A swordsman and a pompadour challenger share one last domain.', ['duel', 'domain'], 'One domain burst per scene visit when opening a title'),
  scene('demon-slayer', 'Breathing room', 'Wisteria shelters a blade of water, flame and wings.', ['wisteria', 'blade'], 'Focus cycles three breathing forms and marks posters'),
  scene('todo-yuji', 'Brothers in arms', 'A clap bends the distance between two allies.', ['brothers', 'clap'], 'A paired shelf switches on a slow beat while unfocused'),
  scene('death-note', 'The last page', 'Only stories you finish earn a line in this notebook.', ['notebook', 'ink'], 'Finished titles become paginated notebook entries'),
  scene('domain-city', 'Domain city', 'A folded skyline inside a neon boundary.', ['city', 'domain'], 'Focus draws a new district boundary'),
  scene('wanted-posters', 'Bounty office', 'A sun-bleached board of stories worth chasing.', ['bounties', 'paper'], 'Saved titles become a bounty shelf'),
  scene('wall-district', 'Beyond the wall', 'Watchlights trace a monumental stone district.', ['wall', 'beacon'], 'Focus moves the watchlight across the battlements'),
  scene('night-train', 'Last train', 'Rain on the window. New stories at every station.', ['train', 'rain'], 'Continue watching becomes the next-station shelf'),
  scene('witch-atelier', 'Ink & alchemy', 'An observatory of hand-drawn circles and hanging stars.', ['atelier', 'stars'], 'Opening a title stamps a new alchemy seal'),
  scene('nerv-grid', 'Signal command', 'An amber command centre awaits a pilot.', ['grid', 'radar'], 'Focused titles appear as the current signal'),
  scene('straw-hat-map', 'Uncharted stories', 'Islands and dotted routes on an original explorer’s chart.', ['map', 'compass'], 'Continue watching charts your next voyage'),
  scene('hashira-forms', 'Nine forms', 'Nine blade crests around a quiet mountain.', ['mountain', 'crests'], 'Every focus step selects the next crest'),
];
export const ANIME_SCENE_KEY = 'tvm.theme.anime.scene';
const listeners = new Set<() => void>();
let memory: string | undefined;
export function readAnimeScene(): string { try { return resolveAnimeScene(memory ?? localStorage.getItem(ANIME_SCENE_KEY)).id; } catch { return memory ?? 'gojo-six-eyes'; } }
export function resolveAnimeScene(id: unknown): AnimeScene { return ANIME_SCENES.find(s => s.id === id) ?? ANIME_SCENES[0]!; }
export function setAnimeScene(id: string): void { memory = resolveAnimeScene(id).id; try { localStorage.setItem(ANIME_SCENE_KEY, memory); } catch { /* Session selection remains usable. */ } listeners.forEach(fn => fn()); }
export function useAnimeScene(): AnimeScene { return resolveAnimeScene(useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, readAnimeScene, () => 'gojo-six-eyes')); }
export function nextAnimeScene(): void { setAnimeScene(ANIME_SCENES[(ANIME_SCENES.findIndex(s => s.id === readAnimeScene()) + 1) % ANIME_SCENES.length]!.id); }
export function animePlatform(flags: { tv: boolean; phone: boolean; desktop: boolean; pointer: boolean }): AnimePlatform { return flags.tv ? 'roku' : flags.phone ? 'mobile' : flags.desktop || flags.pointer ? 'pc' : 'roku'; }
export function currentAnimePlatform(): AnimePlatform { const c = document.documentElement.classList; return animePlatform({ tv: c.contains('tv-preview'), phone: c.contains('phone-shell') || isMobileClient(), desktop: c.contains('desktop-shell'), pointer: matchMedia('(pointer: fine)').matches }); }
export function eyeTarget(platform: AnimePlatform, pointer: { x: number; y: number }, focus: { x: number; y: number }): { x: number; y: number } { return platform === 'pc' ? pointer : focus; }
export function deathNotePage<T extends { id: string }>(finished: readonly T[], page: number): T[] {
  const seen = new Set<string>();
  const unique = finished.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
  const start = Math.max(0, Math.floor(page)) * 40;
  return unique.slice(start, start + 40);
}
