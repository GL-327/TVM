import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tokenMatches } from './security.ts';

export const LAN_COOKIE = 'tvm_lan_session';
const TTL_MS = 12 * 60 * 60 * 1000;

/** Sessions are ephemeral, bounded and revoked by logout, token rotation or Core restart. */
export function createLanSessions(env: NodeJS.ProcessEnv, now = Date.now) {
  const sessions = new Map<string, number>();
  let token = env['TVM_LAN_TOKEN'];
  const cookie = (request: IncomingMessage): string | undefined => request.headers.cookie?.split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${LAN_COOKIE}=`))?.slice(LAN_COOKIE.length + 1);
  function prune(): void {
    if (token !== env['TVM_LAN_TOKEN']) { sessions.clear(); token = env['TVM_LAN_TOKEN']; }
    for (const [id, expires] of sessions) if (expires <= now()) sessions.delete(id);
  }
  function setCookie(response: ServerResponse, value: string, age: number, request: IncomingMessage): void {
    // HTTP is supported only for deliberate private-LAN testing. Never trust forwarded headers.
    const secure = 'encrypted' in request.socket && request.socket.encrypted;
    response.setHeader('set-cookie', `${LAN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`);
    response.setHeader('cache-control', 'no-store');
  }
  return {
    authenticated(request: IncomingMessage): boolean {
      prune();
      return sessions.has(cookie(request) ?? '');
    },
    create(request: IncomingMessage, response: ServerResponse): number | null {
      prune();
      // Even loopback must present a token; the login endpoint cannot mint unprotected LAN access.
      if (!tokenMatches(request.headers.authorization, env['TVM_LAN_TOKEN'])) return null;
      const old = cookie(request); if (old) sessions.delete(old);
      if (sessions.size >= 128) sessions.delete(sessions.keys().next().value!);
      const id = randomBytes(32).toString('base64url');
      const expiresAt = now() + TTL_MS;
      sessions.set(id, expiresAt);
      setCookie(response, id, TTL_MS / 1000, request);
      return expiresAt;
    },
    revoke(request: IncomingMessage, response: ServerResponse): void {
      sessions.delete(cookie(request) ?? '');
      setCookie(response, '', 0, request);
    },
  };
}

// Public pairing assets contain no user information. The app/assets/APIs remain authenticated.
export function serveLanPairing(path: string, request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== 'GET' || !['/', '/connect', '/connect.js'].includes(path)) return false;
  response.setHeader('cache-control', 'no-store');
  if (path === '/connect.js') {
    response.setHeader('content-type', 'text/javascript; charset=utf-8');
    response.end(`document.querySelector('form').addEventListener('submit',async(event)=>{
event.preventDefault();const input=document.querySelector('input');const button=document.querySelector('button');const status=document.querySelector('[role=status]');button.disabled=true;status.textContent='Connecting…';const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
try{const response=await fetch('/api/lan/session',{method:'POST',headers:{Authorization:'Bearer '+input.value.trim()},signal:controller.signal});input.value='';if(!response.ok)throw new Error(response.status===429?'Too many attempts. Wait a minute and try again.':'Connection code not accepted. Check the code on your PC.');location.replace('/');}
catch(error){status.textContent=error.name==='AbortError'?'The PC did not respond. Check your Wi-Fi and try again.':error.message;}finally{clearTimeout(timer);button.disabled=false;}});`);
  } else {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Connect to TVM</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#100b08;color:#f3e6c8;font:16px/1.5 system-ui,sans-serif}main{width:min(100%,440px);padding:32px;border:1px solid #654525;border-radius:24px;background:#20150e}h1{font-size:32px;line-height:1.2}label{display:block;margin:24px 0 8px}input,button{width:100%;font:inherit;padding:14px;border-radius:10px}input{background:#100b08;color:inherit;border:1px solid #8d724f}button{margin-top:16px;border:0;background:#e0a526;color:#1e100a;font-weight:700}button:disabled{opacity:.5}p{color:#cdb48c}small{display:block;margin-top:24px}</style>
<main><small>TVM · PRIVATE TESTING</small><h1>Your television,<br>on your phone.</h1><p>Keep your Windows PC running and connect to the same trusted Wi-Fi.</p><form><label for="code">Connection code from your PC</label><input id="code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required minlength="32"><button>Connect to TVM</button><p role="status" aria-live="polite"></p></form><small>Use only your private home network. This HTTP test connection is not encrypted in transit.</small></main><script src="/connect.js"></script></html>`);
  }
  return true;
}
