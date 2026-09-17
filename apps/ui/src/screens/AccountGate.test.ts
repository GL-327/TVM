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

  it('declares every panel that takes typing to the phone keyboard handling', () => {
    const src = gate();
    // mobile.css pads and scrolls [data-keyboard-fields] by the keyboard inset.
    // The waiting panel had no text field until the owner unlock arrived, so it
    // had no attribute either, and the code field would have opened the keyboard
    // on top of itself.
    const panels = src.match(/<main ref={pageRef} className="gate"/g) ?? [];
    const declared = src.match(/<main ref={pageRef} className="gate" data-keyboard-fields=""/g) ?? [];
    expect(panels.length).toBeGreaterThan(0);
    expect(declared.length).toBe(panels.length);
  });

  /*
   * Reported as "the login page doesn't work", and it looked exactly like that.
   *
   * mode, the typed values and the last notice all outlived the session that
   * produced them, so signing out landed on the register form — pre-filled with
   * the name and address of the account you had just left, under a green
   * "Account created" from the last time you pressed the button. Pressing it
   * again answered "That account could not be created", which is a truthful
   * reply to a question nobody asked.
   */
  it('returns to the sign-in form when the session ends', () => {
    const src = gate();
    const reset = src.slice(src.indexOf('if (state.signedIn) return;'));
    expect(reset).toContain("setMode('signin')");
    expect(reset).toContain("setEmail('')");
    expect(reset).toContain("setPassword('')");
    expect(reset).toContain("setDisplayName('')");
    expect(reset).toContain('setNotice(null)');
    expect(reset).toContain('setMessage(null)');
    // Keyed on the session rather than the screen, so an expiry resets it too.
    expect(src).toContain('}, [state.signedIn]);');
  });

  /*
   * Reported as the developer section not letting the owner grant access.
   *
   * On a fresh install this is their only way in, and it was the last thing on
   * a panel 1380px tall — about 600px below the fold on a laptop, underneath
   * the whole price list. Quiet is right; buried is not, and the person who
   * cannot find it is the one person who needs it.
   */
  it('puts the owner unlock above the price list, not below it', () => {
    const src = gate();
    const waiting = src.slice(src.indexOf('Almost there'));
    const owner = waiting.indexOf('<OwnerUnlock');
    const prices = waiting.indexOf('<Prices tiers={tiers}');
    expect(owner).toBeGreaterThan(-1);
    expect(prices).toBeGreaterThan(-1);
    expect(owner).toBeLessThan(prices);
  });

  /*
   * Reported as "the login doesn't work at all".
   *
   * The gate renders instead of the view stack, and the view stack is the only
   * thing listening to the remote — so nothing had focus, arrows did nothing,
   * and pressing Enter after typing a password did nothing either.
   */
  it('can be driven with a keyboard or a remote, and Enter signs in', () => {
    const src = gate();
    expect(src).toContain('useGateRemote({');
    // Both text panels are real forms that confirm fields on Enter.
    expect(src.match(/<form\s+className="gate__form"/g)?.length).toBe(2);
    expect(src.match(/onKeyDown={confirmFieldOnEnter}/g)?.length).toBe(2);
    expect(src.match(/<button type="submit" className="gate__implicit-submit"/g)?.length).toBe(2);
    // Enter in the email field moves on; in the password field it submits.
    const email = src.slice(src.indexOf('id="gate-email"'), src.indexOf('id="gate-password"'));
    expect(email).toContain("onConfirm={next('gate-password')}");
    const password = src.slice(src.indexOf('id="gate-password"'), src.indexOf('id="gate-submit"'));
    expect(password).toContain('onConfirm={() => void submit()}');
    // A phone keyboard and a password manager both need to know what the fields are.
    expect(email).toContain('inputMode="email"');
    expect(password).toContain("'current-password'");
    // A double press must not register twice.
    expect(src).toContain('inFlight.current');
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
