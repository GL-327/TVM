/**
 * The signed-in account's session token.
 *
 * Kept in localStorage rather than a cookie: the interface is served by a
 * local core and also runs inside two native shells, where cookies behave
 * differently. It travels as a bearer header, so nothing depends on origin.
 */

const TOKEN_KEY = 'tvm.account.token';

export function readToken(): string | null {
  try {
    const value = window.localStorage.getItem(TOKEN_KEY);
    return value !== null && value !== '' ? value : null;
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode: the session still works for this run.
  }
}
