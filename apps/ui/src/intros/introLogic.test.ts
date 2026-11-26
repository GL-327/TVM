import { beforeEach, describe, expect, it } from 'vitest';
import events from '../../../../packages/content/events.json';
import {
  INTROS, baseImdb, clampDuration, hasIntroPlayed, markIntroPlayed, matchIntro, planIntro, resetIntroSession,
} from './introLogic';

const base = { live: false, enabled: true, automation: false };

describe('franchise intro matching', () => {
  beforeEach(() => resetIntroSession());

  it('loads both intros with sane durations', () => {
    expect(INTROS.map((i) => i.id)).toEqual(['hunger-games', 'avengers-doomsday']);
    for (const intro of INTROS) {
      expect(intro.durationMs).toBeGreaterThanOrEqual(2500);
      expect(intro.durationMs).toBeLessThanOrEqual(4000);
    }
  });

  it('matches every Hunger Games and Doomsday rail id', () => {
    const hg = events.events.find((e) => e.id === 'sunrise-on-the-reaping');
    const dd = events.events.find((e) => e.id === 'avengers-doomsday');
    for (const id of hg?.rail.items ?? []) expect(matchIntro(id, '')?.intro.id).toBe('hunger-games');
    for (const id of dd?.rail.items ?? []) expect(matchIntro(id, '')?.intro.id).toBe('avengers-doomsday');
  });

  it('matches X-Men, Deadpool, Logan, Wolverine and X-Men 97 by id', () => {
    for (const id of ['tt0120903', 'tt1431045', 'tt5463162', 'tt6263850', 'tt3315342', 'tt1430132', 'tt0458525', 'tt16026746']) {
      expect(matchIntro(id, '')?.intro.id).toBe('avengers-doomsday');
    }
  });

  it('counts episode ids as their show', () => {
    expect(baseImdb('tt16026746:1:3')).toBe('tt16026746');
    expect(matchIntro('tt16026746:1:3', '')?.titleKey).toBe('tt16026746');
    expect(matchIntro('tt9140554:2:1', 'Loki')?.intro.id).toBe('avengers-doomsday');
  });

  it('falls back to the title regex, case-insensitively', () => {
    expect(matchIntro('rd:abc', 'the HUNGER GAMES: Catching Fire')?.intro.id).toBe('hunger-games');
    expect(matchIntro('rd:abc', 'Deadpool & Wolverine 2024 2160p')?.intro.id).toBe('avengers-doomsday');
    expect(matchIntro('rd:abc', 'Avengers Assemble')?.intro.id).toBe('avengers-doomsday');
    expect(matchIntro('rd:abc', 'Spider-Man: No Way Home')?.intro.id).toBe('avengers-doomsday');
  });

  it('does not match unrelated titles', () => {
    expect(matchIntro('tt0111161', 'The Shawshank Redemption')).toBeNull();
    expect(matchIntro('rd:abc', 'Logan Lucky')).toBeNull();
    expect(matchIntro('rd:abc', '')).toBeNull();
    expect(matchIntro('live:free:news', 'Hunger Games Marathon')?.intro.id).toBe('hunger-games');
  });

  it('draws the subtitle for Hunger Games films and the full name for Marvel', () => {
    expect(matchIntro('tt1951264', '')?.title).toBe('Catching Fire');
    expect(matchIntro('tt1392170', '')?.title).toBe('');
    expect(matchIntro('rd:x', 'The Hunger Games: Mockingjay Part 1')?.title).toBe('Mockingjay Part 1');
    expect(matchIntro('tt21357150', '')?.title).toBe('Avengers: Doomsday');
  });

  it('keeps a bad duration inside 2.5 to 4 seconds', () => {
    expect(clampDuration(100)).toBe(2500);
    expect(clampDuration(99999)).toBe(4000);
    expect(clampDuration(3200)).toBe(3200);
    expect(clampDuration(Number.NaN)).toBe(4000);
  });
});

describe('franchise intro planning', () => {
  beforeEach(() => resetIntroSession());

  it('plays once per title per session, whichever episode starts it', () => {
    const first = planIntro({ ...base, id: 'tt16026746:1:1', title: '' });
    expect(first).not.toBeNull();
    expect(hasIntroPlayed(first?.titleKey ?? '')).toBe(false);
    markIntroPlayed(first?.titleKey ?? '');
    expect(planIntro({ ...base, id: 'tt16026746:1:2', title: '' })).toBeNull();
    expect(planIntro({ ...base, id: 'tt1392170', title: '' })).not.toBeNull();
  });

  it('is skipped when switched off, live, or automated', () => {
    expect(planIntro({ ...base, id: 'tt1392170', title: '', enabled: false })).toBeNull();
    expect(planIntro({ ...base, id: 'tt1392170', title: '', live: true })).toBeNull();
    expect(planIntro({ ...base, id: 'tt1392170', title: '', automation: true })).toBeNull();
  });

  it('keeps a retry from replaying until the intro has been released', () => {
    expect(planIntro({ ...base, id: 'tt1392170', title: '' })).not.toBeNull();
    expect(planIntro({ ...base, id: 'tt1392170', title: '' })).not.toBeNull();
    markIntroPlayed('tt1392170');
    expect(planIntro({ ...base, id: 'tt1392170', title: '' })).toBeNull();
  });

  it('tracks title-matched files by name', () => {
    const a = planIntro({ ...base, id: 'rd:1', title: 'Avengers Assemble' });
    markIntroPlayed(a?.titleKey ?? '');
    expect(planIntro({ ...base, id: 'rd:2', title: 'Avengers Assemble' })).toBeNull();
    expect(planIntro({ ...base, id: 'rd:3', title: 'Iron Man 3' })).not.toBeNull();
  });
});
