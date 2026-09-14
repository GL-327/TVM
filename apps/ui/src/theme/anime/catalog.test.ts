import { describe, expect, it } from 'vitest';
import { ANIME_SCENES, animePlatform, deathNotePage, eyeTarget, resolveAnimeScene } from './catalog';
describe('Anime scenes', () => {
  it('ships all named scenes and eight additional distinct scenes with cross-platform hooks', () => {
    expect(ANIME_SCENES.map(s => s.id)).toEqual(['gojo-six-eyes','mahoraga','invincible-thragg-gojo','dress-up-fireworks','mega-fight','just-this-once','demon-slayer','todo-yuji','death-note','domain-city','wanted-posters','wall-district','night-train','witch-atelier','nerv-grid','straw-hat-map','hashira-forms']);
    expect(new Set(ANIME_SCENES.map(s => s.effects.join())).size).toBe(17);
    for (const s of ANIME_SCENES) { expect(s.hook.length).toBeGreaterThan(20); expect(Object.keys(s.platforms)).toEqual(['pc','mobile','roku']); }
    expect(resolveAnimeScene('bad').id).toBe('gojo-six-eyes');
  });
  it('uses pointer on PC and focus on phones and remotes', () => {
    const pointer = { x: 1, y: 0 }, focus = { x: -.5, y: 1 };
    expect(eyeTarget('pc', pointer, focus)).toBe(pointer);
    expect(eyeTarget('mobile', pointer, focus)).toBe(focus);
    expect(eyeTarget('roku', pointer, focus)).toBe(focus);
    expect(animePlatform({ tv: true, phone: false, desktop: true, pointer: true })).toBe('roku');
    expect(animePlatform({ tv: false, phone: true, desktop: false, pointer: true })).toBe('mobile');
    expect(animePlatform({ tv: false, phone: false, desktop: false, pointer: false })).toBe('roku');
  });
  it('paginates and deduplicates only the supplied confirmed completions', () => {
    const finished = Array.from({length:85},(_,i)=>({id:String(i),title:`Film ${i}`}));
    expect(deathNotePage([...finished, finished[0]!],0)).toHaveLength(40);
    expect(deathNotePage(finished,1)[0]?.id).toBe('40');
    expect(deathNotePage(finished,2)).toHaveLength(5);
    expect(deathNotePage([],0)).toEqual([]);
  });
});
