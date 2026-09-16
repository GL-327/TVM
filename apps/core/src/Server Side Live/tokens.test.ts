import { describe, expect, it } from 'vitest';
import { TokenMinter, isTokenShaped, proxyPath, type TokenStore } from './tokens.ts';

function store(): TokenStore & { value: string | null } {
  const held = { value: null as string | null };
  return {
    get value() { return held.value; },
    set value(next: string | null) { held.value = next; },
    read: () => held.value,
    write: (secret: string) => { held.value = secret; },
  };
}

const target = { url: 'https://panel.example/live/1.m3u8', profileId: 'global', playlist: true };

describe('the names clients see instead of provider URLs', () => {
  it('gives the same URL the same token every time', () => {
    const minter = new TokenMinter(store());
    expect(minter.mint(target)).toBe(minter.mint(target));
  });

  it('separates two channels that share a URL but not their headers', () => {
    const minter = new TokenMinter(store());
    const a = minter.mint(target);
    const b = minter.mint({ ...target, profileId: 'panel-b' });
    expect(a).not.toBe(b);
  });

  /*
   * The reason tokens are derived rather than random. A Roku resuming a
   * channel after the appliance reboots must not meet a 404, and the old
   * in-memory Map guaranteed one.
   */
  it('keeps a URL valid across a restart', () => {
    const held = store();
    const before = new TokenMinter(held).mint(target);
    const after = new TokenMinter(held);
    // A fresh process has an empty reverse map...
    expect(after.resolve(before)).toBeNull();
    // ...but the token a client is holding still derives to the same value,
    // so re-registering it from stored channel data serves that client.
    expect(after.reattach(before, target)).toBe(true);
    expect(after.resolve(before)?.url).toBe(target.url);
    expect(after.mint(target)).toBe(before);
  });

  it('refuses a token that this secret would not have produced', () => {
    const minter = new TokenMinter(store());
    expect(minter.reattach('0'.repeat(32), target)).toBe(false);
    expect(minter.resolve('0'.repeat(32))).toBeNull();
  });

  /*
   * Rotation exists for a URL that has escaped, so it must not let existing
   * sessions finish — a rotation that does is not a rotation.
   */
  it('invalidates every minted URL at once when rotated', () => {
    const held = store();
    const minter = new TokenMinter(held);
    const before = minter.mint(target);
    const secretBefore = held.value;

    minter.rotate();
    expect(held.value).not.toBe(secretBefore);
    expect(minter.resolve(before)).toBeNull();
    expect(minter.reattach(before, target)).toBe(false);
    expect(minter.mint(target)).not.toBe(before);
  });

  it('writes a secret on first use and reuses it afterwards', () => {
    const held = store();
    expect(held.value).toBeNull();
    const first = new TokenMinter(held).mint(target);
    expect(held.value).not.toBeNull();
    expect(new TokenMinter(held).mint(target)).toBe(first);
  });

  it('only accepts tokens of the shape it mints', () => {
    const minter = new TokenMinter(store());
    const token = minter.mint(target);
    expect(isTokenShaped(token)).toBe(true);
    expect(isTokenShaped('../../etc/passwd')).toBe(false);
    expect(isTokenShaped('')).toBe(false);
    expect(isTokenShaped(`${token}x`)).toBe(false);
    expect(proxyPath(token)).toBe(`/api/live/proxy/${token}`);
  });

  it('never puts the upstream URL in the token itself', () => {
    const minter = new TokenMinter(store());
    const token = minter.mint(target);
    const decoded = Buffer.from(token, 'hex').toString('latin1');
    expect(token).not.toContain('panel.example');
    expect(decoded).not.toContain('panel');
  });
});
