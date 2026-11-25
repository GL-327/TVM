import { describe, expect, it } from 'vitest';
import { getParentalContent } from './content';
import { ageLimitLabel, filterItemsByAge, getKidsDefaultAge, passesAgeLimit } from './parental';
import { allowedLiveGroupsForAge, bundledFreeChannels } from './freeLive';
import { derivePinHashHex, isValidPinFormat, recordPinAttempt, remainingLockoutSeconds } from './pin';

describe('F8 PIN KDF & lockout policy', () => {
  it('matches the shared parental.json PBKDF2-HMAC-SHA256 test vector', async () => {
    const vector = getParentalContent().pin.testVector;
    const derived = await derivePinHashHex(vector.pin, vector.saltHex);
    expect(derived).toBe(vector.hashHex);
  });

  it('validates 4-digit PIN format and triggers 60s lockout after 5 wrong guesses', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('abcd')).toBe(false);

    let state = { wrongCount: 0, lockedUntilMs: 0 };
    const now = 1_000_000;
    for (let i = 0; i < 4; i += 1) {
      state = recordPinAttempt(state, false, now);
      expect(remainingLockoutSeconds(state, now)).toBe(0);
    }
    state = recordPinAttempt(state, false, now);
    expect(remainingLockoutSeconds(state, now)).toBe(60);

    const reset = recordPinAttempt(state, true, now + 61_000);
    expect(reset.wrongCount).toBe(0);
    expect(remainingLockoutSeconds(reset, now + 61_000)).toBe(0);
  });
});

describe('F8 Age limit labels and genre/live filtering', () => {
  it('exposes exact UI labels and defaults kids profiles to 7', () => {
    expect(getKidsDefaultAge()).toBe(7);
    expect(ageLimitLabel(7)).toBe('Up to 7');
    expect(ageLimitLabel(12)).toBe('Up to 12');
    expect(ageLimitLabel(15)).toBe('Up to 15');
    expect(ageLimitLabel(18)).toBe('No limit');
  });

  it('filters media by allow/block genres per age limit', () => {
    const sample = [
      { id: '1', genres: ['Animation', 'Family'] },
      { id: '2', genres: ['Action', 'Adventure'] },
      { id: '3', genres: ['Action', 'Thriller'] },
      { id: '4', genres: ['Horror'] },
    ];
    expect(filterItemsByAge(sample, 7).map((i) => i.id)).toEqual(['1']);
    expect(filterItemsByAge(sample, 12).map((i) => i.id)).toEqual(['1', '2']);
    expect(filterItemsByAge(sample, 15).map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(filterItemsByAge(sample, 18).map((i) => i.id)).toEqual(['1', '2', '3', '4']);
    expect(passesAgeLimit(['Animation', 'Horror'], 7)).toBe(false);
  });

  it('filters Live TV groups for restricted profiles using liveGroups', () => {
    expect(allowedLiveGroupsForAge(7)?.has('kids')).toBe(true);
    expect(allowedLiveGroupsForAge(7)?.has('news')).toBe(false);
    const kidsFree = bundledFreeChannels(7);
    expect(kidsFree.every((ch) => ch.group?.toLowerCase() === 'kids')).toBe(true);
  });
});
