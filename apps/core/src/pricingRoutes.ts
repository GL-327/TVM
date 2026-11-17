import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from './http.ts';
import { accountSessionToken, type AccountsService } from './providers/accounts.ts';
import { ACCESS_ROUTE } from './providers/accessTiers.ts';
import { createFeatureFlags } from './providers/featureFlags.ts';
import { priceBookAt, type PriceBook } from './providers/priceBook.ts';
import { createQuoteService, QuoteError, type QuoteInput } from './providers/quotes.ts';

export function createPricingContext(options: {
  dataDir: string; accounts: AccountsService; env?: NodeJS.ProcessEnv; now?: () => Date; books?: readonly PriceBook[];
}) {
  const flags = createFeatureFlags(options);
  const quotes = createQuoteService({ ...options, flags: flags.get });
  return { ...options, flags, quotes };
}
export async function handlePricingApi(request: IncomingMessage, response: ServerResponse, path: string, ctx: ReturnType<typeof createPricingContext>): Promise<boolean> {
  if (!path.startsWith('/api/pricing/') && path !== '/api/admin/flags') return false;
  if (path === '/api/pricing/book' && request.method === 'GET') {
    const flags = ctx.flags.get();
    sendJson(response, 200, { book: priceBookAt(ctx.now?.() ?? new Date(), ctx.books), flags: {
      liveTvVisible: flags['liveTv.visible'], liveTvOrderable: flags['liveTv.orderable'], selfServeBilling: flags.selfServeBilling,
    } });
    return true;
  }
  const header = (name: string): string | undefined => typeof request.headers[name] === 'string' ? request.headers[name] : undefined;
  const account = ctx.accounts.resolve(accountSessionToken(header('authorization'), header('x-tvm-account'), ctx.env?.['TVM_LAN_TOKEN']));
  if (path === '/api/admin/flags' && (request.method === 'GET' || request.method === 'PUT')) {
    if (account?.role !== 'dev') sendJson(response, 403, { error: 'dev_account_required' });
    else if (request.method === 'GET') sendJson(response, 200, { flags: ctx.flags.get() });
    else {
      try { sendJson(response, 200, { flags: ctx.flags.set(await readJson(request)) }); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'invalid_flags') throw error;
        sendJson(response, 400, { error: 'invalid_flags' });
      }
    }
    return true;
  }
  if ((path === '/api/pricing/quote' || path === '/api/pricing/accept') && request.method === 'POST') {
    if (!account || account.suspended) {
      sendJson(response, 401, { error: 'account_required' });
      return true;
    }
    const body = await readJson(request);
    try {
      if (path.endsWith('/quote')) {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(response, 400, { error: 'invalid_quote_input' });
          return true;
        }
        sendJson(response, 200, ctx.quotes.quote(body as QuoteInput, account.id));
      } else {
        const quote = body && typeof body === 'object' && 'quote' in body ? body.quote : body;
        ctx.quotes.accept(quote, account.id);
        // No billing adapter is connected here, even when the rollout flag is enabled.
        // Acceptance records intent only; the existing operator activation remains authoritative.
        sendJson(response, 200, { status: 'manual_activation', message: ACCESS_ROUTE.detail });
      }
    } catch (error) {
      if (error instanceof QuoteError) sendJson(response, error.status, { error: error.code, ...(error.quote ? { quote: error.quote } : {}) });
      else if (error instanceof Error && error.message === 'invalid_quote_input') sendJson(response, 400, { error: error.message });
      else throw error;
    }
    return true;
  }
  return false;
}
