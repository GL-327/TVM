// A stand-in for the private TVM accounts service, for CI checks that sign up
// and sign in through a real packaged Core. Without it, every Windows build
// registered a test account on the owner's live service.
//
//   node native/tools/fake-accounts.mjs <port>
//
// Then start the Core with TVM_ACCOUNTS_URL=http://127.0.0.1:<port> (the Core
// accepts plain HTTP only on loopback). New accounts wait for approval, as on
// the real service; nothing here can activate one.
import { randomBytes } from 'node:crypto';
import http from 'node:http';

const port = Number(process.argv[2] ?? 18787);
const accounts = new Map(); // email -> { account, password }
const sessions = new Map(); // session -> account

const server = http.createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  let body = {};
  try { body = raw === '' ? {} : JSON.parse(raw); } catch { /* treated as empty */ }
  const send = (status, value) => {
    response.writeHead(status, value === undefined ? {} : { 'content-type': 'application/json' });
    response.end(value === undefined ? undefined : JSON.stringify(value));
  };
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const post = request.method === 'POST';

  if (post && path === '/v1/register') {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email.includes('@') || String(body.password ?? '').length < 8) return send(400, { error: 'invalid' });
    if (!accounts.has(email)) {
      accounts.set(email, {
        password: String(body.password),
        account: {
          id: `acc_fixture${accounts.size + 1}`, email, displayName: String(body.displayName ?? ''), role: 'member',
          status: 'waiting', tier: 'stream', liveTv: false, emailVerified: false, termsVersion: null,
          hasRdToken: false, createdAt: new Date().toISOString(), note: null, sessionCount: 0,
        },
      });
    }
    return send(201, { account: accounts.get(email).account });
  }
  if (post && path === '/v1/signin') {
    const entry = accounts.get(String(body.email ?? '').trim().toLowerCase());
    if (entry === undefined || entry.password !== body.password) return send(401, { error: 'invalid' });
    const session = randomBytes(24).toString('base64url');
    sessions.set(session, entry.account);
    return send(200, { session, account: entry.account });
  }

  const account = sessions.get((request.headers.authorization ?? '').replace(/^Bearer /, ''));
  if (account === undefined) return send(401, { error: 'invalid' });
  if (post && path === '/v1/signout') {
    sessions.delete((request.headers.authorization ?? '').replace(/^Bearer /, ''));
    return send(204);
  }
  if (path === '/v1/me' && request.method === 'GET') return send(200, { account });
  if (post && path === '/v1/me/terms') {
    account.termsVersion = typeof body.version === 'string' ? body.version : null;
    return send(200, { account });
  }
  if (path === '/v1/me/rd-token') return send(403, { error: 'forbidden' });
  return send(404, { error: 'not_found' });
});

server.listen(port, '127.0.0.1', () => console.log(`fake accounts service on http://127.0.0.1:${port}`));
