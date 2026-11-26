import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMediaTools, runTool } from './mediaTools.ts';

export type HeroClip =
  | { status: 'ready'; url: string; width: number; height: number; seconds: number }
  | { status: 'preparing' }
  | { status: 'unavailable' };
type ClipInfo = { width: number; height: number; seconds: number };
type Toolset = ReturnType<typeof createMediaTools>;
type Kind = 'hero' | 'theme';
const DAY = 86_400_000;
const MAX_AGE = 30 * DAY;
const imdb = /^tt\d{5,12}$/;
const youtube = /^[\w-]{11}$/;
const toolOptions = { windowsHide: true, maxBuffer: 2 * 1024 * 1024 };
const ytArgs = ['--ignore-config', '--no-playlist', '--no-warnings', '--no-progress', '--js-runtimes', `node:${process.execPath}`];
const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export function themerrPath(id: string, tmdbId?: number, series?: boolean): string | null {
  if (!imdb.test(id)) return null;
  const root = 'https://raw.githubusercontent.com/Themerr/ThemerrDB/database/';
  if (series) return Number.isSafeInteger(tmdbId) && tmdbId! > 0 ? `${root}tv_shows/themoviedb/${tmdbId}.json` : null;
  return `${root}movies/imdb/${id}.json`;
}

export function themeYoutubeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1)
      : ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) && url.pathname === '/watch'
        ? url.searchParams.get('v') : null;
    return id && youtube.test(id) ? id : null;
  } catch { return null; }
}

export async function renderHeroClip(youtubeId: string, output: string, stage: string, tools: Toolset): Promise<ClipInfo> {
  const [bin, { ffmpeg, ffprobe }] = await Promise.all([tools.ytdlp(), tools.ffmpeg()]);
  const url = videoUrl(youtubeId);
  const { stdout } = await runTool(bin, [...ytArgs, '--skip-download', '--print', 'duration', '--', url],
    { ...toolOptions, timeout: 25_000 });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration < 12 || duration > 900) throw new Error('Trailer duration unavailable');
  const seconds = Math.min(38, Math.floor(duration));
  const start = Math.max(0, Math.round((duration - seconds) / 2));
  const input = join(stage, 'source.mp4');
  await runTool(bin, [...ytArgs, '--ffmpeg-location', ffmpeg, '--format', 'bv*[ext=mp4][height<=1080]/bv*[height<=1080]',
    '--download-sections', `*${start}-${start + seconds}`, '--force-keyframes-at-cuts',
    '--max-filesize', '96M', '--output', input, '--', url], { ...toolOptions, timeout: 80_000 });
  await runTool(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', input, '-map', '0:v:0', '-an',
    '-t', String(seconds), '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output],
  { ...toolOptions, timeout: 65_000 });
  const info = await runTool(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,codec_name:format=duration', '-of', 'json', output], { ...toolOptions, timeout: 8000 });
  const { streams, format } = JSON.parse(info.stdout) as {
    streams?: { width: number; height: number; codec_name: string }[]; format?: { duration?: string };
  };
  const video = streams?.[0];
  const measured = Number(format?.duration);
  if (!video || video.codec_name !== 'h264' || !(measured > 0 && measured <= 45)) throw new Error('Invalid preview output');
  return { width: video.width, height: video.height, seconds: Math.round(measured * 100) / 100 };
}

async function renderTheme(youtubeId: string, output: string, stage: string, tools: Toolset): Promise<void> {
  const [bin, { ffmpeg }] = await Promise.all([tools.ytdlp(), tools.ffmpeg()]);
  const source = join(stage, 'audio.m4a');
  await runTool(bin, [...ytArgs, '--format', 'ba[ext=m4a]/ba', '--max-filesize', '24M', '--output', source, '--', videoUrl(youtubeId)],
    { ...toolOptions, timeout: 55_000 });
  await runTool(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', source, '-map', '0:a:0',
    '-vn', '-t', '90', '-af', 'volume=0.5', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output],
  { ...toolOptions, timeout: 20_000 });
}

export function createPreviewMedia(options: {
  dataDir: string;
  trailers: (id: string) => Promise<{ youtubeId: string; name: string }[]>;
  title: (id: string) => Promise<{ tmdbId?: number; series: boolean } | null>;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  tools?: Toolset;
  makeClip?: typeof renderHeroClip;
}) {
  const root = join(options.dataDir, 'cache', 'previews');
  const fetchImpl = options.fetch ?? fetch;
  const tools = options.tools ?? createMediaTools(options.dataDir, options.env, fetchImpl);
  const now = options.now ?? Date.now;
  const pending = new Map<string, Promise<void>>();
  const unavailable = new Map<string, number>();
  const media = (kind: Kind, id: string) => join(root, id + (kind === 'hero' ? '.mp4' : '.m4a'));
  const infoFile = (id: string) => join(root, id + '.json');
  async function savedFile(kind: Kind, id: string): Promise<string | null> {
    if (!imdb.test(id)) return null;
    const path = media(kind, id);
    const file = await stat(path).catch(() => null);
    return file?.isFile() && file.size > 0 && now() - file.mtimeMs < MAX_AGE ? path : null;
  }
  async function savedClip(id: string): Promise<ClipInfo | null> {
    if (!await savedFile('hero', id)) return null;
    try {
      const info = JSON.parse(await readFile(infoFile(id), 'utf8')) as ClipInfo;
      return Number.isInteger(info.width) && info.width > 0 && info.width <= 1920 &&
        Number.isInteger(info.height) && info.height > 0 && info.height <= 1080 &&
        Number.isFinite(info.seconds) && info.seconds > 0 && info.seconds <= 45 ? info : null;
    } catch { return null; }
  }
  async function prune(): Promise<void> {
    const files = (await readdir(root)).filter(name => /^tt\d{5,12}\.(mp4|m4a)$/.test(name));
    const rows = await Promise.all(files.map(async name => ({ name, file: await stat(join(root, name)).catch(() => null) })));
    rows.sort((a, b) => (b.file?.mtimeMs ?? 0) - (a.file?.mtimeMs ?? 0));
    let bytes = 0;
    for (const [index, { name, file }] of rows.entries()) {
      if (!file) continue;
      bytes += file.size;
      const id = name.split('.')[0]!;
      const kind = name.endsWith('.mp4') ? 'hero' : 'theme';
      if (pending.has(`${kind}:${id}`)) continue;
      if (index < 64 && bytes <= 512 * 1024 ** 2 && now() - file.mtimeMs < MAX_AGE) continue;
      await rm(join(root, name), { force: true });
      if (kind === 'hero') await rm(infoFile(id), { force: true });
    }
  }
  function start(kind: Kind, id: string): Promise<void> | undefined {
    const key = `${kind}:${id}`;
    const active = pending.get(key);
    if (active) return active;
    if (pending.size >= 2) return undefined;
    const task = build(kind, id).catch(() => {
      if (unavailable.size >= 512) unavailable.delete(unavailable.keys().next().value!);
      unavailable.set(key, now() + 30 * 60_000);
    }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
    pending.set(key, task);
    return task;
  }
  async function build(kind: Kind, id: string): Promise<void> {
    await mkdir(root, { recursive: true });
    const stage = await mkdtemp(join(root, 'stage-'));
    try {
      const output = join(stage, kind === 'hero' ? 'clip.mp4' : 'theme.m4a');
      if (kind === 'hero') {
        const trailers = (await options.trailers(id)).filter(trailer => youtube.test(trailer.youtubeId));
        const selected = trailers.find(trailer => /official.*trailer/i.test(trailer.name)) ?? trailers[0];
        if (!selected) throw new Error('Trailer missing');
        const info = await (options.makeClip ?? renderHeroClip)(selected.youtubeId, output, stage, tools);
        const metadata = join(stage, 'clip.json');
        await writeFile(metadata, JSON.stringify(info));
        await rename(output, media(kind, id));
        await rename(metadata, infoFile(id));
      } else {
        const title = await options.title(id);
        const lookup = themerrPath(id, title?.tmdbId, title?.series);
        if (!lookup) throw new Error('Theme missing');
        const response = await fetchImpl(lookup, { redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Theme missing');
        const body = await response.json() as { youtube_theme_url?: unknown };
        const video = themeYoutubeId(body.youtube_theme_url);
        if (!video) throw new Error('Theme missing');
        await renderTheme(video, output, stage, tools);
        await rename(output, media(kind, id));
      }
    } finally { await rm(stage, { recursive: true, force: true }); }
    await prune().catch(() => {});
  }
  return {
    async hero(id: string): Promise<HeroClip> {
      if (!imdb.test(id)) return { status: 'unavailable' };
      const info = await savedClip(id);
      if (info) return { status: 'ready', url: `/api/extras/hero-clip.mp4?id=${id}`, ...info };
      if (now() < (unavailable.get(`hero:${id}`) ?? 0)) return { status: 'unavailable' };
      start('hero', id);
      return { status: 'preparing' };
    },
    async theme(id: string): Promise<{ url: string } | null> {
      if (!imdb.test(id) || now() < (unavailable.get(`theme:${id}`) ?? 0)) return null;
      if (!await savedFile('theme', id)) await start('theme', id);
      return await savedFile('theme', id) ? { url: `/api/extras/theme.m4a?id=${id}` } : null;
    },
    async file(kind: Kind, id: string): Promise<string | null> {
      if (kind === 'hero' && !await savedClip(id)) return null;
      return savedFile(kind, id);
    },
    ytdlp: () => tools.ytdlp().catch(() => null),
  };
}
