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

  it('names each state in plain human language with no raw codes', () => {
    const src = gate();
    expect(src).toContain('Sign in to TVM');
    expect(src).toContain('Enter your password');
    expect(src).toContain('Create your account');
    expect(src).toContain("You're on the list");
    expect(src).toContain('Your account is paused');
    expect(src).toContain('Accept the terms to continue');
    expect(src).toContain('Confirm your email to continue');
    expect(src).toContain('accountStatusLabel(state)');
  });

  /*
   * Accounts live on the private account server and users with role === 'dev'
   * sign in normally with their email and password. No tabs, no dev code entry.
   */
  it('uses a two-step email-then-password flow without tab pills or developer code entry', () => {
    const src = gate();
    expect(src).not.toContain('gate-tabs');
    expect(src).not.toContain('gate-tab');
    expect(src).not.toContain('id="gate-dev"');
    expect(src).not.toContain("I'm a dev");
    expect(src).not.toContain("switchMode('dev')");
    expect(src).not.toContain('gate-dev-code');
    expect(src).not.toContain('signInDev');
    expect(src).not.toContain("addEventListener('tvm:secret-door'");
    expect(src).not.toContain('unlockDeveloper');
    expect(src).toContain('New here? Create an account');
    expect(src).toContain('I already have an account');
    expect(src).toContain('id="gate-change-email"');
    expect(src).toContain('id="gate-password-toggle"');
    expect(src).toContain('id="gate-forgot"');
    expect(src).toContain('Ask the owner to reset it.');
    expect(src).toContain("typed('gate-email', email).trim()");
    expect(src).toContain("typed('gate-password', password)");
  });

  it('auto-rechecks waiting accounts every 60 seconds and on visibility change', () => {
    const src = gate();
    expect(src).toContain('RECHECK_INTERVAL_MS = 60_000');
    expect(src).toContain('window.setInterval');
    expect(src).toContain('visibilitychange');
    expect(src).toContain('id="recheck"');
    expect(src).toContain('Check again');
  });

  it('asks for the emailed code before the account can go any further', () => {
    const src = gate();
    const panel = src.slice(src.indexOf('// ---- Email code verification'), src.indexOf('// ---- Waiting for approval'));
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
  it('returns to the clean email step when the session ends', () => {
    const src = gate();
    const reset = src.slice(src.indexOf('if (state.signedIn) return;'));
    expect(reset).toContain("setMode('signin')");
    expect(reset).toContain("setStep('email')");
    expect(reset).toContain("setEmail('')");
    expect(reset).toContain("setPassword('')");
    expect(reset).toContain("setDisplayName('')");
    expect(reset).toContain("setInviteCode('')");
    expect(reset).toContain("setEmailCode('')");
    expect(reset).toContain('setAgreedTerms(false)');
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
  it('can be driven with a keyboard or a remote, and Enter confirms or signs in', () => {
    const src = gate();
    expect(src).toContain('useGateRemote({');
    // Email, password, register, and email-code forms all confirm on Enter.
    expect(src.match(/<form[\s\S]*?className="gate__form"/g)?.length).toBe(4);
    expect(src.match(/onKeyDown={confirmFieldOnEnter}/g)?.length).toBe(4);
    expect(src.match(/<button type="submit" className="gate__implicit-submit"/g)?.length).toBe(4);
    // Enter in password submits; Enter on email advances to password.
    expect(src).toContain('onConfirm={advanceToPassword}');
    expect(src).toContain('onConfirm={() => void submitSignIn()}');
    expect(src).toContain('onConfirm={() => void submitRegister()}');
    // A phone keyboard and a password manager both need to know what the fields are.
    expect(src).toContain('inputMode="email"');
    expect(src).toContain('autoComplete="current-password"');
    expect(src).toContain('autoComplete="new-password"');
    // A double press must not send two requests.
    expect(src).toContain('inFlight.current');
    // Back from password returns to email, and from register returns to sign-in.
    expect(src).toContain('backToEmail');
    expect(src).toContain("() => switchMode('signin')");
  });

  it('announces inline field errors and keeps focus inside the invalid field', () => {
    const src = gate();
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain('ariaDescribedBy=');
    expect(src).toContain('ariaInvalid=');
    expect(src).toContain("focusInput('gate-email')");
    expect(src).toContain("focusInput('gate-password')");
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

  it('offers an optional invite code field on account creation', () => {
    const src = gate();
    expect(src).toContain('id="gate-invite"');
    expect(src).toContain('Optional invite code');
    expect(src).toContain('inviteCode: nextInvite');
  });
});
