import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { connect as connectTcp, isIP, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';
import { mailPath } from '../update/paths.ts';
import { deleteSecret } from './secrets.ts';
import { readSealed, writeSealed } from './vault.ts';
import { EMAIL_CODE_MINUTES, emailLooksValid } from './accounts.ts';

/**
 * Sends the sign-up codes.
 *
 * Plain SMTP, so it works with whatever the dev already has: an iCloud or
 * Gmail app password, or a send-only relay such as Resend or Brevo. The
 * settings are sealed in secrets/mail.enc and the password never leaves Core.
 *
 * TVM will not send a password over an unencrypted connection. "none" is only
 * accepted for a relay on this machine.
 */

export type MailSecurity = 'tls' | 'starttls' | 'none';

export interface MailSettings {
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password: string;
  from: string;
}

export interface MailStatus {
  configured: boolean;
  host: string | null;
  port: number | null;
  security: MailSecurity | null;
  username: string | null;
  from: string | null;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const HOST = /^[A-Za-z0-9.-]{1,253}$/;

function isSecurity(value: unknown): value is MailSecurity {
  return value === 'tls' || value === 'starttls' || value === 'none';
}

function field(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Checks what the dev typed. An empty password keeps the saved one, so the
 * form can be re-saved without typing it again.
 */
export function readMailSettings(input: unknown, previous: MailSettings | null = null): MailSettings {
  const source = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const host = field(source['host']).toLowerCase();
  if (!HOST.test(host)) throw new Error('Enter the mail server, for example smtp.mail.me.com.');
  const port = typeof source['port'] === 'number' ? source['port'] : Number(field(source['port']));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Enter the port, usually 587 or 465.');
  const security = source['security'];
  if (!isSecurity(security)) throw new Error('Choose how to connect: TLS, STARTTLS or none.');
  if (security === 'none' && !LOCAL_HOSTS.has(host)) {
    throw new Error('Only a mail relay on this machine can be used without encryption.');
  }
  const username = field(source['username']);
  if (username.length > 254 || /[\r\n]/.test(username)) throw new Error('That username is not valid.');
  const typed = typeof source['password'] === 'string' ? source['password'] : '';
  if (/[\r\n]/.test(typed) || typed.length > 500) throw new Error('That password is not valid.');
  const password = typed !== '' ? typed : (previous?.host === host && previous.username === username ? previous.password : '');
  if (username !== '' && password === '') throw new Error('Enter the password for that username.');
  const from = field(source['from']).toLowerCase();
  if (!emailLooksValid(from)) throw new Error('Enter the address the codes should come from.');
  return { host, port, security, username, password, from };
}

export function mailStatus(settings: MailSettings | null): MailStatus {
  if (settings === null) {
    return { configured: false, host: null, port: null, security: null, username: null, from: null };
  }
  return {
    configured: true,
    host: settings.host,
    port: settings.port,
    security: settings.security,
    username: settings.username === '' ? null : settings.username,
    from: settings.from,
  };
}

export function loadMailSettings(dataDir: string): MailSettings | null {
  const stored = readSealed<unknown>(dataDir, mailPath(dataDir));
  if (stored === null) return null;
  try {
    return readMailSettings(stored);
  } catch {
    return null;
  }
}

// ---- SMTP -----------------------------------------------------------------

interface Reply {
  code: number;
  lines: string[];
}

class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}

function replyText(reply: Reply): string {
  return reply.lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Reads SMTP replies off a socket, one complete (possibly multi-line) reply at a time. */
function replyReader(socket: Socket | TLSSocket) {
  let buffer = '';
  let lines: string[] = [];
  const ready: Reply[] = [];
  let waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;
  let failure: Error | null = null;

  const fail = (error: Error): void => {
    if (failure !== null) return;
    failure = error;
    const pending = waiting;
    waiting = null;
    pending?.reject(error);
  };

  const onData = (chunk: Buffer): void => {
    buffer += chunk.toString('latin1');
    let end = buffer.indexOf('\n');
    while (end !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      const match = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (match === null) {
        fail(new MailError('The mail server sent something TVM did not understand.'));
        return;
      }
      lines.push(match[3] ?? '');
      if (match[2] !== '-') {
        const reply = { code: Number(match[1]), lines };
        lines = [];
        const pending = waiting;
        waiting = null;
        if (pending !== null) pending.resolve(reply);
        else ready.push(reply);
      }
      end = buffer.indexOf('\n');
    }
  };
  const onError = (error: Error): void => fail(error);
  const onClose = (): void => fail(new MailError('The mail server closed the connection.'));

  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);

  return {
    next(): Promise<Reply> {
      const queued = ready.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      if (failure !== null) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
      });
    },
    detach(): void {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    },
  };
}

function extensions(ehlo: Reply): string[] {
  return ehlo.lines.slice(1).map((line) => line.trim().toUpperCase());
}

function authMethods(ehlo: Reply): string[] {
  const line = extensions(ehlo).find((entry) => entry.startsWith('AUTH ') || entry.startsWith('AUTH='));
  return line === undefined ? [] : line.slice(5).split(/\s+/).filter((entry) => entry !== '');
}

function heloName(): string {
  const name = hostname();
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(name) ? name : 'localhost';
}

/** RFC 5322 text. ASCII only, CRLF line ends, lines starting with a dot doubled. */
export function formatMessage(from: string, message: MailMessage, at: Date = new Date()): string {
  const domain = from.split('@')[1] ?? 'localhost';
  const headers = [
    `From: TVM <${from}>`,
    `To: <${message.to}>`,
    `Subject: ${message.subject}`,
    `Date: ${at.toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=us-ascii',
    'Content-Transfer-Encoding: 7bit',
  ];
  const body = message.text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line));
  return [...headers, '', ...body].join('\r\n');
}

export interface SendOptions {
  timeoutMs?: number;
}

export async function sendMail(settings: MailSettings, message: MailMessage, options: SendOptions = {}): Promise<void> {
  if (!emailLooksValid(message.to)) throw new MailError('That email address is not valid.');
  if (/[\r\n]/.test(message.subject)) throw new MailError('That subject is not valid.');

  const servername = isIP(settings.host) === 0 ? settings.host : undefined;
  let socket: Socket | TLSSocket = settings.security === 'tls'
    ? connectTls({ host: settings.host, port: settings.port, servername })
    : connectTcp({ host: settings.host, port: settings.port });
  const timer = setTimeout(() => {
    socket.destroy(new MailError('The mail server took too long to answer.'));
  }, options.timeoutMs ?? 20_000);

  let reader = replyReader(socket);
  const send = (line: string): void => {
    socket.write(`${line}\r\n`);
  };
  const expect = async (codes: number[], step: string): Promise<Reply> => {
    const reply = await reader.next();
    if (!codes.includes(reply.code)) {
      throw new MailError(`The mail server refused ${step} (${reply.code} ${replyText(reply)}).`);
    }
    return reply;
  };

  try {
    await expect([220], 'the connection');
    send(`EHLO ${heloName()}`);
    let ehlo = await expect([250], 'the greeting');

    if (settings.security === 'starttls') {
      if (!extensions(ehlo).includes('STARTTLS')) {
        throw new MailError('The mail server does not offer STARTTLS, so TVM will not send the password to it.');
      }
      send('STARTTLS');
      await expect([220], 'STARTTLS');
      reader.detach();
      const plain = socket;
      // Errors on the raw socket surface through the TLS socket from here on.
      plain.on('error', () => undefined);
      const secured = connectTls({ socket: plain, servername });
      socket = secured;
      reader = replyReader(secured);
      await new Promise<void>((resolve, reject) => {
        secured.once('secureConnect', () => resolve());
        secured.once('error', reject);
      });
      send(`EHLO ${heloName()}`);
      ehlo = await expect([250], 'the greeting');
    }

    if (settings.username !== '') {
      const methods = authMethods(ehlo);
      if (methods.includes('PLAIN')) {
        send(`AUTH PLAIN ${Buffer.from(` ${settings.username} ${settings.password}`, 'utf8').toString('base64')}`);
        await expect([235], 'the sign-in');
      } else if (methods.includes('LOGIN')) {
        send('AUTH LOGIN');
        await expect([334], 'the sign-in');
        send(Buffer.from(settings.username, 'utf8').toString('base64'));
        await expect([334], 'the sign-in');
        send(Buffer.from(settings.password, 'utf8').toString('base64'));
        await expect([235], 'the sign-in');
      } else {
        throw new MailError('The mail server does not accept a username and password in a way TVM supports.');
      }
    }

    send(`MAIL FROM:<${settings.from}>`);
    await expect([250], 'the sender address');
    send(`RCPT TO:<${message.to}>`);
    await expect([250, 251], 'the recipient');
    send('DATA');
    await expect([354], 'the message');
    socket.write(`${formatMessage(settings.from, message)}\r\n.\r\n`);
    await expect([250], 'the message');
    send('QUIT');
    await reader.next().catch(() => undefined);
  } finally {
    clearTimeout(timer);
    reader.detach();
    socket.on('error', () => undefined);
    socket.destroy();
  }
}

export function codeMessage(to: string, code: string): MailMessage {
  return {
    to,
    subject: `Your TVM code is ${code}`,
    text: [
      `Your TVM code is ${code}`,
      '',
      `Type it into TVM to confirm this is your email address. It stops working in ${EMAIL_CODE_MINUTES} minutes.`,
      '',
      "If you didn't ask for this, you can ignore this email.",
    ].join('\n'),
  };
}

export interface MailServiceOptions {
  dataDir: string;
  send?: (settings: MailSettings, message: MailMessage) => Promise<void>;
}

export function createMailService(options: MailServiceOptions) {
  const { dataDir } = options;
  const send = options.send ?? ((settings: MailSettings, message: MailMessage) => sendMail(settings, message));

  const settings = (): MailSettings => {
    const loaded = loadMailSettings(dataDir);
    if (loaded === null) throw new MailError('Email is not set up on this TVM.');
    return loaded;
  };

  return {
    configured(): boolean {
      return loadMailSettings(dataDir) !== null;
    },
    status(): MailStatus {
      return mailStatus(loadMailSettings(dataDir));
    },
    save(input: unknown): MailStatus {
      const next = readMailSettings(input, loadMailSettings(dataDir));
      writeSealed(dataDir, mailPath(dataDir), next);
      return mailStatus(next);
    },
    clear(): MailStatus {
      deleteSecret(mailPath(dataDir));
      return mailStatus(null);
    },
    async sendCode(to: string, code: string): Promise<void> {
      await send(settings(), codeMessage(to, code));
    },
    async sendTest(to: string): Promise<void> {
      await send(settings(), {
        to,
        subject: 'TVM email test',
        text: 'This is a test from TVM. Sign-up codes will come from this address.',
      });
    },
  };
}

export type MailService = ReturnType<typeof createMailService>;
