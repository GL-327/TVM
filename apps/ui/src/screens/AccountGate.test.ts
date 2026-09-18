import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const gate = (): string => readFileSync(join(dir, 'AccountGate.tsx'), 'utf8');
const app = (): string => readFileSync(join(dir, '../App.tsx'), 'utf8');

describe('the door', () => {
  it('is the app shell on every platform that loads the React UI', () => {
    const src = app();
    expect(src).toContain('AccountGate');
    expect(src).toContain('if (!account.usable.ok)');
    expect(src).toContain('<ViewStackProvider />');
    expect(src.indexOf('AccountGate')).toBeLessThan(src.indexOf('<ViewStackProvider />'));
  });

  it('comes back when the account changes from inside the app', () => {
    const src = app();
    expect(src).toContain('ACCOUNT_CHANGED');
    expect(src).toContain('window.addEventListener(ACCOUNT_CHANGED, changed)');
  });

  it('names the state someone is in rather than failing generically', () => {
    const src = gate();
    expect(src).toContain('Almost there');
    expect(src).toContain('This account is switched off');
    expect(src).toContain('Before you start');
    expect(src).toContain('Sign in to TVM');
    expect(src).toContain('Check your email');
  });

  /*
   * The gate renders instead of every screen, so on a fresh install the only
   * way in for the owner has to be on the gate itself. It used to be a hidden
   * code form on the waiting panel, reached by registering first.
   */
  it('puts the dev account on the sign-in screen', () => {
    const src = gate();
    const signedOut = src.slice(src.indexOf('// ---- Signed out'));
    expect(signedOut).toContain('id="gate-dev"');
    expect(signedOut).toContain("I'm a dev");
    expect(signedOut).toContain("switchMode('dev')");
    expect(signedOut.indexOf('id="gate-dev"')).toBeLessThan(signedOut.indexOf('<Prices tiers={tiers}'));

    const devPanel = src.slice(src.indexOf('// ---- The dev account'), src.indexOf('// ---- Signed out'));
    expect(devPanel).toContain('<h1>Dev account</h1>');
    expect(devPanel).toContain('id="gate-dev-code"');
    expect(devPanel).toContain('type="password"');
    expect(devPanel).toContain('void submitDev(');
    expect(src).toContain('signInDev(code.trim())');
  });

  it('no longer needs the hidden owner form', () => {
    const src = gate();
    expect(src).not.toContain('OwnerUnlock');
    expect(src).not.toContain("addEventListener('tvm:secret-door'");
    expect(src).not.toContain('unlockDeveloper');
  });

  it('asks for the emailed code before the account can go any further', () => {
    const src = gate();
    const panel = src.slice(src.indexOf('// ---- The emailed code'), src.indexOf('// ---- Waiting on the dev'));
    expect(panel).toContain("reason === 'email_unverified'");
    expect(panel).toContain('id="gate-code"');
    expect(panel).toContain('autoComplete="one-time-code"');
    expect(panel).toContain('inputMode="numeric"');
    expect(panel).toContain('void confirmEmail(');
    expect(panel).toContain('void resendEmail()');
    expect(panel).toContain('id="signout"');
    expect(src).toContain('verifyEmailCode(digits)');
  });

  it('declares every panel that takes typing to the phone keyboard handling', () => {
    const src = gate();
    // mobile.css pads and scrolls [data-keyboard-fields] by the keyboard inset,
    // so a panel without it opens the keyboard on top of its own field.
    const panels = src.match(/<main ref={pageRef} className="gate"/g) ?? [];
    const declared = src.match(/<main ref={pageRef} className="gate" data-keyboard-fields=""/g) ?? [];
    expect(panels.length).toBeGreaterThan(0);
    expect(declared.length).toBe(panels.length);
  });

  /*
   * Signing out once landed on the register form, filled in with the last
   * account's name and address under an old "Account created" notice.
   */
  it('returns to the sign-in form when the session ends', () => {
    const src = gate();
    const reset = src.slice(src.indexOf('if (state.signedIn) return;'));
    expect(reset).toContain("setMode('signin')");
    expect(reset).toContain("setEmail('')");
    expect(reset).toContain("setPassword('')");
    expect(reset).toContain("setDisplayName('')");
    expect(reset).toContain("setDevCode('')");
    expect(reset).toContain("setEmailCode('')");
    expect(reset).toContain('setNotice(null)');
    expect(reset).toContain('setMessage(null)');
    // Keyed on the session rather than the screen, so an expiry resets it too.
    expect(src).toContain('}, [state.signedIn]);');
  });

  /*
   * The gate replaces the view stack, which is the only other thing listening
   * to the remote. Without its own handler nothing had focus and Enter after a
   * password did nothing.
   */
  it('can be driven with a keyboard or a remote, and Enter signs in', () => {
    const src = gate();
    expect(src).toContain('useGateRemote({');
    // Sign-in, dev code and email code: all real forms that confirm on Enter.
    expect(src.match(/<form\s+className="gate__form"/g)?.length).toBe(3);
    expect(src.match(/onKeyDown={confirmFieldOnEnter}/g)?.length).toBe(3);
    expect(src.match(/<button type="submit" className="gate__implicit-submit"/g)?.length).toBe(3);
    // Enter in the email field moves on; in the password field it submits.
    const email = src.slice(src.indexOf('id="gate-email"'), src.indexOf('id="gate-password"'));
    expect(email).toContain("onConfirm={next('gate-password')}");
    const password = src.slice(src.indexOf('id="gate-password"'), src.indexOf('id="gate-submit"'));
    expect(password).toContain('onConfirm={() => void submit()}');
    // A phone keyboard and a password manager both need to know what the fields are.
    expect(email).toContain('inputMode="email"');
    expect(password).toContain("'current-password'");
    // A double press must not send two requests.
    expect(src).toContain('inFlight.current');
    // Back from the dev code returns to signing in.
    expect(src).toContain("mode !== 'signin' ? () => switchMode('signin') : undefined");
  });

  it('keeps the door itself free of anything that grants access on its own', () => {
    const src = gate();
    // The code is checked by Core and never compared here, so the gate cannot
    // be read to learn it.
    expect(src).not.toContain('SpongeBob');
    expect(src).not.toContain(['TheBest', 'DayEver'].join(''));
    // Switching people on happens in Accounts, behind dev mode; the gate never
    // writes account state itself.
    expect(src).not.toContain('localStorage.setItem');
    expect(src).not.toContain('activateAccount');
  });
});
