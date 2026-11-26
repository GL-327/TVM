#!/usr/bin/env node
/*
 * Checks the shared data every TVM app ships with (packages/content). Clients
 * also refresh these files from GitHub, so a bad edit here reaches installed
 * apps without a release: the shapes they validate are checked here first.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'content');
const errors = [];
const fail = (message) => errors.push(message);
const load = (name) => {
  try {
    return JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
  } catch (error) {
    fail(`${name}: ${error.message}`);
    return null;
  }
};
const https = (value) => typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value);
const day = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const imdb = (value) => typeof value === 'string' && /^tt\d{6,10}$/.test(value);
const hex = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const unique = (items, name) => {
  const ids = new Set();
  for (const item of items) {
    if (typeof item?.id !== 'string' || !/^[a-z0-9-]+$/.test(item.id)) fail(`${name}: bad id ${JSON.stringify(item?.id)}`);
    if (ids.has(item.id)) fail(`${name}: duplicate id ${item.id}`);
    ids.add(item.id);
  }
  return ids;
};

const avatars = load('avatars.json');
const avatarSets = avatars?.sets ?? [];
if (avatars?.schema !== 1 || !Array.isArray(avatarSets) || avatarSets.length === 0) fail('avatars.json: schema 1 with sets');
const setIds = unique(avatarSets, 'avatars.json sets');
for (const set of avatarSets) {
  if (!Array.isArray(set.avatars) || set.avatars.length === 0) fail(`avatars.json ${set.id}: no avatars`);
  unique(set.avatars ?? [], `avatars.json ${set.id}`);
  for (const avatar of set.avatars ?? []) if (!https(avatar.image) || typeof avatar.name !== 'string') fail(`avatars.json ${set.id}/${avatar.id}: name and https image`);
}

const events = load('events.json');
if (events?.schema !== 1 || !Array.isArray(events?.events)) fail('events.json: schema 1 with events');
unique(events?.events ?? [], 'events.json');
for (const event of events?.events ?? []) {
  const where = `events.json ${event.id}`;
  if (!imdb(event.imdbId)) fail(`${where}: imdbId`);
  if (!day(event.start) || !day(event.end) || !day(event.release)) fail(`${where}: start/end/release dates`);
  if (event.start > event.end) fail(`${where}: start after end`);
  if (!hex(event.accent) || !hex(event.glow)) fail(`${where}: accent/glow colours`);
  if (event.effect !== undefined && !['embers', 'sparks', 'snow', 'dust', 'stars', 'none'].includes(event.effect)) fail(`${where}: effect`);
  if (typeof event.title !== 'string' || typeof event.line !== 'string') fail(`${where}: title and line`);
  if (!Array.isArray(event.rail?.items) || event.rail.items.length === 0 || !event.rail.items.every(imdb)) fail(`${where}: rail items are IMDb ids`);
  if (event.avatarSet !== null && event.avatarSet !== undefined && !setIds.has(event.avatarSet)) fail(`${where}: avatarSet ${event.avatarSet} not in avatars.json`);
}

const channels = load('free-channels.json');
if (channels?.schema !== 1 || !Array.isArray(channels?.channels) || channels.channels.length === 0) fail('free-channels.json: schema 1 with channels');
unique(channels?.channels ?? [], 'free-channels.json');
const guideFeeds = channels?.epgFeeds;
if (!Array.isArray(guideFeeds) || !guideFeeds.length) fail('free-channels.json: epgFeeds must contain public HTTPS feeds');
unique(guideFeeds ?? [], 'free-channels.json epgFeeds');
const guideFeedIds = new Set((guideFeeds ?? []).map(feed => feed.id));
for (const feed of guideFeeds ?? []) {
  if (!https(feed.url)) fail(`free-channels.json epgFeeds ${feed.id}: HTTPS URL required`);
}
for (const channel of channels?.channels ?? []) {
  const where = `free-channels.json ${channel.id}`;
  if (!https(channel.url) || !/\.m3u8(\?|$)/.test(new URL(channel.url).pathname + (new URL(channel.url).search ? '?' : ''))) fail(`${where}: https .m3u8 url`);
  if (typeof channel.name !== 'string' || typeof channel.group !== 'string') fail(`${where}: name and group`);
  if (channel.logo !== null && channel.logo !== undefined && !https(channel.logo)) fail(`${where}: logo must be https`);
  if (channel.epgId !== undefined || channel.epgFeed !== undefined) {
    if (typeof channel.epgId !== 'string' || !channel.epgId.trim() || channel.epgId.length > 256 || !guideFeedIds.has(channel.epgFeed)) {
      fail(`${where}: epgId must identify a channel in a listed epgFeed`);
    }
  }
  if (channel.geo !== null && !/^[A-Z]{2}$/.test(String(channel.geo))) fail(`${where}: geo is a country code or null`);
}

const services = load('services.json');
if (services?.schema !== 1 || !Array.isArray(services?.services)) fail('services.json: schema 1 with services');
unique(services?.services ?? [], 'services.json');
for (const service of services?.services ?? []) {
  const where = `services.json ${service.id}`;
  if (!https(service.signin) || !https(service.home)) fail(`${where}: signin and home are https`);
  if (service.search !== null && (!https(service.search.replace('{q}', 'x')) || !service.search.includes('{q}'))) fail(`${where}: search is an https template with {q}`);
  if (service.roku !== null && !/^\d+$/.test(String(service.roku))) fail(`${where}: roku is a numeric channel id`);
  if (!hex(service.accent)) fail(`${where}: accent`);
}

const intros = load('intros.json');
if (intros?.schema !== 1 || !Array.isArray(intros?.intros) || intros.intros.length === 0) fail('intros.json: schema 1 with intros');
unique(intros?.intros ?? [], 'intros.json');
const eventIds = new Set((events?.events ?? []).map((event) => event.id));
for (const intro of intros?.intros ?? []) {
  const where = `intros.json ${intro.id}`;
  if (!eventIds.has(intro.event)) fail(`${where}: event ${intro.event} not in events.json`);
  if (!['mockingjay', 'doom'].includes(intro.style)) fail(`${where}: style`);
  if (!Array.isArray(intro.imdbIds) || intro.imdbIds.length === 0 || !intro.imdbIds.every(imdb)) fail(`${where}: imdbIds are IMDb ids`);
  if (new Set(intro.imdbIds).size !== intro.imdbIds.length) fail(`${where}: duplicate imdbIds`);
  try { new RegExp(intro.titlePattern, 'i'); } catch { fail(`${where}: titlePattern is not a valid regex`); }
  if (!hex(intro.accent) || !hex(intro.glow)) fail(`${where}: accent/glow colours`);
  if (!Number.isInteger(intro.durationMs) || intro.durationMs < 2500 || intro.durationMs > 4000) fail(`${where}: durationMs 2500 to 4000`);
  for (const key of Object.keys(intro.titles ?? {})) if (!intro.imdbIds.includes(key)) fail(`${where}: title for ${key} which is not in imdbIds`);
}

const parental = load('parental.json');
const ages = (parental?.levels ?? []).map((level) => level.maxAge);
if (parental?.schema !== 1 || ages.join(',') !== '7,12,15,18') fail('parental.json: levels 7, 12, 15, 18');

if (errors.length > 0) {
  console.error(`Content check failed:\n - ${errors.join('\n - ')}`);
  process.exit(1);
}
console.log(
  `Content ok: ${avatarSets.length} avatar sets, ${events.events.length} events, ${channels.channels.length} free channels, ${services.services.length} services.`,
);
