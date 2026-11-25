import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProfileService,
  hashPin,
  loadProfiles,
  PIN_LOCKOUT_MS,
  PIN_MAX_TRIES,
  pinMatches,
  publicRegistry,
} from './profiles.ts';
import { allowedForLevel, FALLBACK_LEVELS, filterForLevel, levelFor, liveGroupAllowed, parseLevels } from './parental.ts';

describe('profile PINs', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-locks-'));
    dirs.push(dir);
    return dir;
  }

  // The same vector Windows tests its BCrypt PBKDF2 against (parental.json).
  it('hashes a PIN the way every app does', () => {
    expect(hashPin('1234', '00112233445566778899aabbccddeeff', 20_000)).toBe(
      '1eeaf002a05b931ed2f5dd9fd99fc48b215f8e2dc3f300d356eb83bfe6a4adb4',
    );
    const stored = { salt: '00112233445566778899aabbccddeeff', hash: '1eeaf002a05b931ed2f5dd9fd99fc48b215f8e2dc3f300d356eb83bfe6a4adb4', iter: 20_000 };
    expect(pinMatches(stored, '1234')).toBe(true);
    expect(pinMatches(stored, '4321')).toBe(false);
    expect(pinMatches(stored, '12345')).toBe(false);
  });

  it('never shows the hash, only that a profile is locked', async () => {
    const dir = await dataDir();
    const profiles = createProfileService(dir);
    profiles.create('Kid', 10, { kind: 'kids', pin: '2468', avatar: 'jujutsu-kaisen/gojo' });
    const view = publicRegistry(profiles.list());
    const kid = view.profiles.find((profile) => profile.name === 'Kid');
    expect(kid).toMatchObject({ kind: 'kids', maxAge: 7, locked: true, avatar: 'jujutsu-kaisen/gojo' });
    expect(JSON.stringify(view)).not.toContain('hash');
    // Written sealed, read back with the new fields intact.
    const again = loadProfiles(dir).profiles.find((profile) => profile.name === 'Kid');
    expect(again?.pin?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('asks for the PIN, counts wrong ones, then cools down', async () => {
    let clock = 1_000_000;
    const profiles = createProfileService(await dataDir(), () => clock);
    profiles.create('Locked', 10, { pin: '1357' });
    const id = profiles.list().profiles.find((profile) => profile.name === 'Locked')!.id;
    expect(() => profiles.unlock(id, undefined)).toThrow(expect.objectContaining({ code: 'pin-required' }));
    for (let attempt = 1; attempt < PIN_MAX_TRIES; attempt += 1) {
      expect(() => profiles.unlock(id, '0000')).toThrow(expect.objectContaining({ code: 'pin-wrong' }));
    }
    expect(() => profiles.unlock(id, '0000')).toThrow(expect.objectContaining({ code: 'pin-cooldown' }));
    // Even the right PIN waits out the cooldown.
    expect(() => profiles.unlock(id, '1357')).toThrow(expect.objectContaining({ code: 'pin-cooldown' }));
    clock += PIN_LOCKOUT_MS + 1;
    expect(() => profiles.unlock(id, '1357')).not.toThrow();
  });

  it('needs the current PIN to change or remove a lock', async () => {
    const profiles = createProfileService(await dataDir());
    profiles.create('Me', 10, { pin: '1111' });
    const id = profiles.list().profiles.find((profile) => profile.name === 'Me')!.id;
    expect(() => profiles.update(id, { pin: '2222' }, '9999')).toThrow(expect.objectContaining({ code: 'pin-wrong' }));
    profiles.update(id, { pin: '2222' }, '1111');
    expect(() => profiles.unlock(id, '2222')).not.toThrow();
    profiles.update(id, { pin: null }, '2222');
    expect(publicRegistry(profiles.list()).profiles.find((profile) => profile.id === id)?.locked).toBe(false);
  });

  it('will not let a kids profile lift its own limit while a grown-up profile is locked', async () => {
    const profiles = createProfileService(await dataDir());
    const adult = profiles.list().profiles[0]!.id;
    profiles.update(adult, { pin: '4321' });
    profiles.create('Kid', 10, { kind: 'kids' });
    const kid = profiles.list().profiles.find((profile) => profile.name === 'Kid')!.id;
    expect(() => profiles.update(kid, { kind: 'standard' })).toThrow(expect.objectContaining({ code: 'pin-required' }));
    profiles.update(kid, { kind: 'standard' }, '4321');
    expect(publicRegistry(profiles.list()).profiles.find((profile) => profile.id === kid)).toMatchObject({ kind: 'standard', maxAge: 18 });
  });

  it('rejects a PIN that is not four digits and an unknown age', async () => {
    const profiles = createProfileService(await dataDir());
    expect(() => profiles.create('Bad', 10, { pin: '12a4' })).toThrow(expect.objectContaining({ code: 'pin-invalid' }));
    expect(() => profiles.create('Bad', 10, { maxAge: 9 })).toThrow('Age limit');
  });
});

describe('age limits', () => {
  const film = (genres: string[], kind: 'movie' | 'series' | 'file' = 'movie') => ({ genres, kind });

  it('keeps under-7s to animation and family, without the scary bits', () => {
    const level = levelFor(7);
    expect(allowedForLevel(film(['Animation', 'Comedy']), level)).toBe(true);
    expect(allowedForLevel(film(['Family', 'Horror']), level)).toBe(false);
    expect(allowedForLevel(film(['Action']), level)).toBe(false);
    expect(allowedForLevel(film([], 'file'), level)).toBe(false);
  });

  it('blocks horror and crime at 12, only horror at 15, nothing at 18', () => {
    expect(allowedForLevel(film(['Crime', 'Drama']), levelFor(12))).toBe(false);
    expect(allowedForLevel(film(['Crime', 'Drama']), levelFor(15))).toBe(true);
    expect(allowedForLevel(film(['Horror']), levelFor(15))).toBe(false);
    expect(filterForLevel([film(['Horror']), film(['Comedy'])], levelFor(18))).toHaveLength(2);
  });

  it('falls back to safe rules when parental.json is unreadable', () => {
    expect(parseLevels(null)).toBe(FALLBACK_LEVELS);
    expect(parseLevels([{ maxAge: 7 }])).toBe(FALLBACK_LEVELS);
  });

  it('limits Live TV groups', () => {
    expect(liveGroupAllowed('Kids', levelFor(7))).toBe(true);
    expect(liveGroupAllowed('News', levelFor(7))).toBe(false);
    expect(liveGroupAllowed('News', levelFor(15))).toBe(true);
  });
});

describe('age certificates', () => {
  it('turns BBFC and MPA labels into ages', async () => {
    const { certificateAge, certificatesFromSparql } = await import('./certificates.ts');
    expect(certificateAge('12A certificate')).toBe(12);
    expect(certificateAge('U certificate')).toBe(0);
    expect(certificateAge('PG-13')).toBe(13);
    expect(certificateAge('R')).toBe(17);
    expect(certificateAge('Unrated')).toBeNull();
    const found = certificatesFromSparql({
      results: {
        bindings: [
          { imdb: { value: 'tt0816692' }, bbfcLabel: { value: '12A certificate' }, mpaLabel: { value: 'PG-13' } },
          { imdb: { value: 'tt0816692' }, bbfcLabel: { value: '12 certificate' }, mpaLabel: { value: 'PG-13' } },
          { imdb: { value: 'tt0084787' }, mpaLabel: { value: 'R' } },
        ],
      },
    });
    expect(found.get('tt0816692')).toEqual({ label: '12A', age: 12 });
    expect(found.get('tt0084787')).toEqual({ label: 'R', age: 17 });
  });

  it('lets a real certificate decide before genres', () => {
    expect(allowedForLevel({ genres: ['Crime'], kind: 'movie' }, levelFor(12), { age: 12 })).toBe(true);
    expect(allowedForLevel({ genres: ['Animation'], kind: 'movie' }, levelFor(7), { age: 13 })).toBe(false);
    expect(allowedForLevel({ genres: ['Drama'], kind: 'movie' }, levelFor(7), { age: 0 })).toBe(true);
  });
});
