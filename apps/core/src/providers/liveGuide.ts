import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { LiveChannel } from './types.ts';
import { xtreamPlayerApiUrl, xtreamStreamId, type XtreamAccount } from './xtream.ts';

export interface Programme {
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
  image?: string;
  episode?: string;
}
export interface GuideChannel {
  id: string;
  number: number;
  name: string;
  logo: string | null;
  group: string;
  source: 'free' | 'm3u' | 'xtream';
  programmes: Programme[];
}
export interface Guide {
  now: string;
  start: string;
  end: string;
  groups: string[];
  channels: GuideChannel[];
}
export type GuideWindow = Pick<Guide, 'now' | 'start' | 'end'>;
export interface EpgFeed { id: string; url: string }
type Match = { id?: string; name?: string };
type Schedule = { at: number; matches: [string, Programme[]][] };

const HOUR = 3_600_000;
const TTL = 6 * HOUR;
const MAX_XML_BYTES = 256 * 1024 * 1024;
const MAX_ROW = 512 * 1024;
const MAX_PROGRAMMES = 150_000;

export function guideWindow(start: string | null, hours: string | null, now = Date.now()): GuideWindow | null {
  const begin = start === null ? Math.floor(now / (HOUR / 2)) * (HOUR / 2) : Date.parse(start);
  const span = hours === null ? 3 : Number(hours);
  if (!Number.isFinite(begin) || (start && !/^\d{4}-\d\d-\d\dT/i.test(start)) ||
      !Number.isInteger(span) || span < 1 || span > 24) return null;
  const end = new Date(begin + span * HOUR);
  if (!Number.isFinite(end.getTime())) return null;
  return { now: new Date(now).toISOString(), start: new Date(begin).toISOString(), end: end.toISOString() };
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };
function xmlText(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|apos|quot);/gi, (full, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity] ?? full;
    const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : full;
  });
}
function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map(([, key, double, single]) => [key!, xmlText(double ?? single ?? '')]));
}
function elements(row: string, name: string): string[] {
  return [...row.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map(match =>
    match[1]!.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map(part => part.startsWith('<![CDATA[') ?
      part.slice(9, -3) : xmlText(part.replace(/<[^>]*>/g, ''))).join('').replace(/\s+/g, ' ').trim().slice(0, 6000)).filter(Boolean);
}
function xmlDate(value: string | undefined): string | null {
  const fields = value?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*(Z|UTC|[+-]\d{4}))?$/i);
  if (!fields) return null;
  const [, y, m, d, h, minute, sec = '00', zone = 'Z'] = fields;
  const offset = zone.startsWith('+') || zone.startsWith('-') ? zone.slice(0, 3) + ':' + zone.slice(3) : 'Z';
  const time = Date.parse(`${y}-${m}-${d}T${h}:${minute}:${sec}${offset}`);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function httpAsset(value: string | undefined): string | undefined {
  try {
    const url = value ? new URL(value) : null;
    return url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
const nameKey = (value: string): string => value.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Keep only one XMLTV record in memory in addition to the retained schedule. */
export async function parseXmlTv(input: AsyncIterable<Uint8Array>, wanted?: Match[], now?: number): Promise<Map<string, Programme[]>> {
  const iterator = input[Symbol.asyncIterator]();
  async function* source() {
    try {
      for (;;) {
        const row = await iterator.next();
        if (row.done) return;
        if (row.value.byteLength) yield Buffer.from(row.value);
      }
    } finally { await iterator.return?.(); }
  }
  const chunks = source();
  const first = await chunks.next();
  if (first.done) return new Map();
  const second = first.value.byteLength === 1 ? await chunks.next() : undefined;
  const head = second?.value ? Buffer.concat([first.value, second.value]) : first.value;
  const upstream = Readable.from((async function* () {
    try { yield head; yield* chunks; }
    finally { await chunks.return(undefined); }
  })());
  const gzip = head[0] === 0x1f && head[1] === 0x8b ? createGunzip() : null;
  if (gzip) upstream.on('error', error => gzip.destroy(error));
  const data = gzip ? upstream.pipe(gzip) : upstream;
  const schedules = new Map<string, Programme[]>();
  const aliases = new Map<string, string>();
  const wantedIds = new Set(wanted?.flatMap(item => item.id ? [item.id] : []));
  const wantedNames = new Set(wanted?.flatMap(item => item.name ? [nameKey(item.name)] : []));
  const idCase = new Map([...wantedIds].map(id => [id.toLowerCase(), id]));
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  let count = 0;
  let valid = false;
  const mark = /<(?:(channel|programme)\b|tv\b)|<\/(?:channel|programme)>|<!--|<!\[CDATA\[/g;
  let record: { kind: string; start: number } | null = null;
  let offset = 0;
  const processRow = (kind: string, row: string) => {
    const open = row.match(/^<[^>]+>/)?.[0];
    if (!open) return;
    const attr = attributes(open);
    if (kind === 'channel' && attr.id) {
      for (const name of elements(row, 'display-name').map(nameKey)) {
        if ((!wanted || wantedNames.has(name)) && !aliases.has(name)) aliases.set(name, attr.id);
      }
      return;
    }
    if (kind !== 'programme' || !attr.channel) return;
    const id = attr.channel;
    if (wanted && !idCase.has(id.toLowerCase()) && ![...aliases.values()].includes(id)) return;
    const start = xmlDate(attr.start);
    const end = xmlDate(attr.stop);
    if (!start || !end || start >= end || (now !== undefined && (Date.parse(end) < now - 72 * HOUR || Date.parse(start) > now + 14 * 24 * HOUR))) return;
    const [title] = elements(row, 'title');
    if (!title) return;
    if (++count > MAX_PROGRAMMES) throw new Error('Guide has too many programmes');
    const image = httpAsset(attributes(row.match(/<icon\b[^>]*>/i)?.[0] ?? '').src);
    const entry: Programme = { start, end, title };
    const fields = { subtitle: 'sub-title', description: 'desc', category: 'category', episode: 'episode-num' } as const;
    for (const [key, tag] of Object.entries(fields)) {
      const [value] = elements(row, tag);
      if (value) entry[key as keyof typeof fields] = value;
    }
    if (image) entry.image = image;
    const list = schedules.get(id);
    if (list) list.push(entry);
    else schedules.set(id, [entry]);
  };
  try {
    for await (const bytes of data) {
      size += bytes.byteLength;
      if (size > MAX_XML_BYTES) throw new Error('Guide exceeds its size limit');
      buffer += decoder.decode(bytes, { stream: true });
      mark.lastIndex = offset;
      for (let token = mark.exec(buffer); token; token = mark.exec(buffer)) {
        const text = token[0];
        if (text === '<!--' || text === '<![CDATA[') {
          const close = text === '<!--' ? '-->' : ']]>';
          const index = buffer.indexOf(close, mark.lastIndex);
          if (index === -1) { mark.lastIndex = token.index; break; }
          mark.lastIndex = index + close.length;
        } else if (token[1]) record = { kind: token[1], start: token.index };
        else if (text === '<tv') valid = true;
        else if (record && text === `</${record.kind}>`) {
          processRow(record.kind, buffer.slice(record.start, mark.lastIndex));
          record = null;
        }
        offset = mark.lastIndex;
      }
      if (record && buffer.length - record.start > MAX_ROW) throw new Error('Guide record exceeds its size limit');
      const keepFrom = Math.min(record?.start ?? Infinity, offset || Math.max(0, buffer.length - 24));
      if (keepFrom > 0) {
        buffer = buffer.slice(keepFrom);
        offset = Math.max(0, offset - keepFrom);
        if (record) record.start -= keepFrom;
      }
      if (buffer.length > MAX_ROW) throw new Error('Guide record exceeds its size limit');
    }
  } finally {
    data.destroy();
    upstream.destroy();
  }
  if (!valid || record) throw new Error('Invalid XMLTV document');
  for (const [id, rows] of schedules) {
    rows.sort((a, b) => a.start.localeCompare(b.start));
    const canonical = idCase.get(id.toLowerCase());
    if (canonical && canonical !== id && !schedules.has(canonical)) schedules.set(canonical, rows);
  }
  for (const [name, id] of aliases) {
    const rows = schedules.get(id);
    if (rows) schedules.set(`name:${name}`, rows);
  }
  return schedules;
}

function epgText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length % 4 === 0 && /^[\w+/]+={0,2}$/.test(trimmed)) {
    const bytes = Buffer.from(trimmed, 'base64');
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (decoded && !/[\u0000-\u001f\u007f]/.test(decoded)) return decoded.slice(0, 6000);
    } catch { /* Some panels send plain text. */ }
  }
  return trimmed.slice(0, 6000);
}
export function parseXtreamEpg(payload: unknown): Programme[] {
  const value = payload as { epg_listings?: unknown };
  if (!Array.isArray(value?.epg_listings)) return [];
  const time = (unix: unknown, stamp: unknown): number => {
    if ((typeof unix === 'string' || typeof unix === 'number') && Number(unix) > 0 && Number(unix) < 1e12) return Number(unix) * 1000;
    if (typeof stamp !== 'string') return NaN;
    const utc = stamp.replace(' ', 'T');
    return Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(utc) ? utc : utc + 'Z');
  };
  return value.epg_listings.slice(0, 100).flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const start = time(row.start_timestamp, row.start);
    const end = time(row.stop_timestamp ?? row.end_timestamp, row.end ?? row.stop);
    const title = epgText(row.title);
    if (!title || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
    const description = epgText(row.description);
    return [{ start: new Date(start).toISOString(), end: new Date(end).toISOString(), title, ...(description ? { description } : {}) }];
  }).sort((a, b) => a.start.localeCompare(b.start));
}

const localNetworks = new BlockList();
for (const [ip, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) {
  localNetworks.addSubnet(ip, bits, 'ipv4');
}
for (const [ip, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  localNetworks.addSubnet(ip, bits, 'ipv6');
}
function localIp(value: string): boolean {
  const family = isIP(value);
  return family === 4 ? localNetworks.check(value, 'ipv4') : family === 6 && localNetworks.check(value, 'ipv6');
}
async function fetchGuide(fetchImpl: typeof fetch, raw: string, signal: AbortSignal, trustedOrigin?: string): Promise<Response> {
  let next = raw;
  for (let hops = 0; hops <= 3; hops++) {
    const safe = httpAsset(next);
    if (!safe) break;
    const url = new URL(safe);
    if (url.origin !== trustedOrigin) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
      if (!addresses.length || addresses.some(row => localIp(row.address))) break;
    }
    const response = await fetchImpl(safe, { signal, redirect: 'manual' });
    const redirect = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && redirect) {
      await response.body?.cancel();
      next = new URL(redirect, safe).href;
      continue;
    }
    if (response.ok && response.body) return response;
    await response.body?.cancel();
    break;
  }
  throw new Error('Guide source unavailable');
}

export function createGuideCache(dataDir: string, fetchImpl: typeof fetch = fetch) {
  const root = join(dataDir, 'cache', 'guide');
  const snapshots = new Map<string, Promise<Schedule | null>>();
  const refreshing = new Set<string>();
  const retry = new Map<string, number>();
  async function snapshot(key: string, ttl: number, download: () => Promise<Map<string, Programme[]>>) {
    const id = createHash('sha256').update(key).digest('hex');
    const file = join(root, `${id}.json`);
    if (!snapshots.has(id)) {
      if (snapshots.size >= 256) snapshots.delete(snapshots.keys().next().value!);
      snapshots.set(id, readFile(file, 'utf8').then(text => JSON.parse(text) as Schedule).catch(() => null));
    }
    const value = await snapshots.get(id);
    const now = Date.now();
    if ((!value || now - value.at >= ttl) && !refreshing.has(id) && now >= (retry.get(id) ?? 0)) {
      refreshing.add(id);
      void (async () => {
        const matches = [...await download()];
        const next = { at: Date.now(), matches };
        snapshots.set(id, Promise.resolve(next));
        await mkdir(root, { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
          await rename(temp, file);
        } finally { await rm(temp, { force: true }); }
      })().catch(() => {
        if (retry.size >= 256) retry.delete(retry.keys().next().value!);
        retry.set(id, Date.now() + 60_000);
      }).finally(() => refreshing.delete(id));
    }
    return new Map(value?.matches);
  }
  const xml = (url: string, wants: Match[], origin?: string) => snapshot(JSON.stringify(['xml-v1', url, wants]), TTL, async () => {
    const res = await fetchGuide(fetchImpl, url, AbortSignal.timeout(30_000), origin);
    return parseXmlTv(res.body!, wants, Date.now());
  });
  const short = (account: XtreamAccount, channels: LiveChannel[]) => {
    if (channels.length === 0) return Promise.resolve(new Map<string, Programme[]>());
    return snapshot(JSON.stringify(['short-v1', account, channels.map(row => row.id)]), TTL, async () => {
      const out = new Map<string, Programme[]>();
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(6, channels.length) }, async () => {
        while (index < channels.length) {
          const row = channels[index++]!;
          const streamId = xtreamStreamId(row.id);
          if (!streamId) continue;
          try {
            const response = await fetchImpl(`${xtreamPlayerApiUrl(account, 'get_short_epg')}&stream_id=${encodeURIComponent(streamId)}&limit=24`,
              { signal: AbortSignal.timeout(4000), redirect: 'error' });
            if (response.ok) out.set(row.id, parseXtreamEpg(await response.json()));
          } catch { /* An individual channel may have no guide. */ }
        }
      }));
      return out;
    });
  };
  return { xml, short };
}

export function epgFeeds(raw: unknown): EpgFeed[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(row => typeof row?.id === 'string' && /^https:\/\//i.test(row.url ?? '') && httpAsset(row.url)
    ? [{ id: row.id, url: row.url as string }] : []).slice(0, 12);
}
export function matchGuide(schedule: Map<string, Programme[]>, keys: Match): Programme[] {
  return (keys.id ? schedule.get(keys.id) : undefined) ?? (keys.name ? schedule.get(`name:${nameKey(keys.name)}`) : undefined) ?? [];
}
export function programmeWindow(rows: Programme[], window: GuideWindow): Programme[] {
  const starts = new Set<string>();
  const matching = rows.filter(row => row.end > window.start && row.start < window.end && !starts.has(row.start) && starts.add(row.start));
  return matching.length ? matching : [{ start: window.start, end: window.end, title: 'No guide information' }];
}
