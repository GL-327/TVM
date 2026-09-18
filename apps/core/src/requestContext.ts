import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The account session a request came with, for code deep inside the request
 * that has no other way to know. Real-Debrid uses it to pick the account's own
 * key instead of threading an account through every media call.
 */
const current = new AsyncLocalStorage<{ sessionToken: string | undefined }>();

export function runForSession<T>(sessionToken: string | undefined, work: () => T): T {
  return current.run({ sessionToken }, work);
}

export function currentSessionToken(): string | undefined {
  return current.getStore()?.sessionToken;
}
