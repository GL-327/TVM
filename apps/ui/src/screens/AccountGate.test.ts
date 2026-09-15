import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const gate = (): string => readFileSync(join(dir, 'AccountGate.tsx'), 'utf8');

describe('the door', () => {
  it('names the state someone is in rather than failing generically', () => {
    const src = gate();
    expect(src).toContain('Almost there');
    expect(src).toContain('This account is switched off');
    expect(src).toContain('Before you start');
    expect(src).toContain('Sign in to TVM');
  });

  /*
   * The one that matters.
   *
   * Activation lives in developer mode, developer mode is a screen, and the
   * gate renders instead of the screens — so a fresh install left the owner
   * registered, waiting, and with no way to switch themselves on. Their own
   * app was shut to them. Nothing caught it because nothing tested the first
   * run, so this is the test that would have.
   */
  it('lets the owner reach developer mode from behind the gate', () => {
    const src = gate();
    expect(src).toContain('function OwnerUnlock');
    expect(src).toContain('unlockDeveloper');
    expect(src).toContain('activateAccount');
    expect(src).toContain('I am the app owner');
    // Offered on the panel that strands them, not only in the abstract.
    const waiting = src.slice(src.indexOf('Almost there'));
    expect(waiting).toContain('<OwnerUnlock');
    // Both tiers, so the owner is not forced into the smaller one.
    expect(src).toContain("activate('stream')");
    expect(src).toContain("activate('stream-live')");
  });

  it('keeps the door itself free of anything that grants access on its own', () => {
    const src = gate();
    // The code is checked by the core and never compared here, so the gate
    // cannot be read to learn it.
    expect(src).not.toContain('SpongeBob');
    // Activation goes through the admin route, which re-checks developer mode
    // on every call; the gate must not write account state itself.
    expect(src).not.toContain('localStorage.setItem');
    expect(src).toContain("activateAccount({ id: accountId, tier })");
  });
});
