/**
 * Which channels actually play.
 *
 * A reseller panel will happily list twenty thousand channels and serve a dead
 * URL for most of them, so "the playlist loaded" says almost nothing about
 * whether Live TV works. This checks channels one at a time and reports, per
 * channel, whether real media came back — and when it did not, whose fault it
 * was, because "your subscription was refused" and "this channel has stopped
 * broadcasting" need completely different responses from the viewer.
 *
 * The classification is kept separate from the fetching so it can be tested
 * against every failure a provider produces without touching the network.
 */

export type ChannelVerdict =
  | 'working'
  | 'unauthorized'
  | 'missing'
  | 'offline'
  | 'silent'
  | 'empty'
  | 'unplayable'
  | 'unreachable';

export type ChannelTransport = 'hls' | 'mpegts' | null;

/** What a probe observed. Deliberately free of URLs: a report must not carry a subscription. */
export interface ProbeOutcome {
  /** HTTP status of the channel request, or null when the request never completed. */
  status: number | null;
  /** Set when the request failed before a response (DNS, refused, reset). */
  networkError?: string | undefined;
  /**
   * The connection opened but nothing arrived in time. Kept apart from
   * networkError because the two mean opposite things: one is the viewer's
   * connection, the other is a channel that is not broadcasting.
   */
  timedOut?: boolean | undefined;
  /** First bytes of the body, used to tell MPEG-TS from HLS from an error page. */
  head?: Uint8Array | undefined;
  contentType?: string | undefined;
  /** For HLS only: the result of fetching the first segment the manifest named. */
  segmentStatus?: number | null | undefined;
  segmentBytes?: number | undefined;
  /** True when the manifest parsed but named no segment at all. */
  manifestEmpty?: boolean | undefined;
}

export interface ChannelCheck {
  id: string;
  name: string;
  group: string;
  verdict: ChannelVerdict;
  ok: boolean;
  status: number | null;
  transport: ChannelTransport;
  detail: string;
  ms: number;
}

export interface LiveCheckReport {
  startedAt: string;
  finishedAt: string;
  /** How many channels the playlist held when the check ran. */
  total: number;
  checked: number;
  working: number;
  results: ChannelCheck[];
}

/** MPEG-TS is a stream of 188-byte packets, each beginning 0x47. */
export const TS_PACKET = 188;
export const TS_SYNC = 0x47;

/**
 * Real transport-stream bytes, not merely a plausible first byte.
 *
 * 0x47 is also the letter "G", so a sync byte alone proves nothing and even a
 * sync byte every 188 bytes is not enough: a run of "GGGG..." satisfies that
 * trivially, and providers really do answer with text. Each candidate packet
 * therefore has to look like a packet.
 *
 * The cheap structural test is the adaptation field control, bits 5-4 of the
 * fourth byte. ISO 13818-1 reserves 00, so a real packet never carries it —
 * and 0x47 in that position decodes to exactly 00, which is what rules out a
 * body of repeated "G".
 */
export function looksLikeTransportStream(head: Uint8Array): boolean {
  if (head.length < TS_PACKET * 2) return false;

  const packetAt = (offset: number): boolean => {
    if (head[offset] !== TS_SYNC) return false;
    const fourth = head[offset + 3];
    if (fourth === undefined) return false;
    // Reserved value: this is not a transport packet.
    if (((fourth >> 4) & 0b11) === 0) return false;
    // Transport error indicator set on every packet means corrupt, not playing.
    return ((head[offset + 1] ?? 0) & 0b1000_0000) === 0;
  };

  let start = -1;
  for (let i = 0; i + TS_PACKET + 3 < head.length && i < TS_PACKET; i += 1) {
    if (packetAt(i) && packetAt(i + TS_PACKET)) { start = i; break; }
  }
  if (start < 0) return false;

  let seen = 0;
  for (let i = start; i + 3 < head.length; i += TS_PACKET) {
    if (!packetAt(i)) return false;
    seen += 1;
  }
  return seen >= 2;
}

export function looksLikeManifest(head: Uint8Array): boolean {
  const text = new TextDecoder().decode(head.subarray(0, 512));
  return /^\s*#EXTM3U/i.test(text) || /#EXT-X-|#EXTINF:/i.test(text);
}

/**
 * Turns one probe into a verdict a person can act on.
 *
 * The wording matters as much as the classification: the point of this feature
 * is to be able to say "Live TV works" or "Live TV does not work, and here is
 * who has to fix it" without guessing.
 */
export function classify(outcome: ProbeOutcome): Pick<ChannelCheck, 'verdict' | 'ok' | 'detail' | 'transport'> {
  const { status } = outcome;

  if (outcome.timedOut === true) {
    // Reported separately from "unreachable" on purpose. A dead pay-per-view
    // slot behaves exactly like this — the socket opens and no video ever
    // comes — and telling someone their connection is broken when the other
    // channels in the same sweep are playing sends them after the wrong fault.
    return {
      verdict: 'silent',
      ok: false,
      transport: null,
      detail: 'The provider accepted the connection but sent no video. This channel is listed but is not broadcasting.',
    };
  }

  if (outcome.networkError !== undefined) {
    return {
      verdict: 'unreachable',
      ok: false,
      transport: null,
      detail: `Could not reach the provider (${outcome.networkError}).`,
    };
  }

  if (status === 401 || status === 403) {
    return {
      verdict: 'unauthorized',
      ok: false,
      transport: null,
      detail: `The provider refused this channel (${status}). Usually the subscription does not include it, or too many devices are streaming at once.`,
    };
  }

  if (status === 404 || status === 410) {
    return { verdict: 'missing', ok: false, transport: null, detail: `This channel is gone from the provider (${status}).` };
  }

  if (status !== null && (status < 200 || status >= 300) && status !== 206) {
    return { verdict: 'unreachable', ok: false, transport: null, detail: `The provider answered ${status}.` };
  }

  const head = outcome.head ?? new Uint8Array(0);
  if (head.length === 0) {
    return { verdict: 'empty', ok: false, transport: null, detail: 'The provider accepted the request but sent no data.' };
  }

  if (looksLikeTransportStream(head)) {
    // These *are* the video bytes. Nothing further needs to succeed.
    return { verdict: 'working', ok: true, transport: 'mpegts', detail: 'Playing — MPEG-TS video is streaming.' };
  }

  if (looksLikeManifest(head)) {
    if (outcome.manifestEmpty === true) {
      return { verdict: 'offline', ok: false, transport: 'hls', detail: 'The channel exists but is not broadcasting right now (its playlist is empty).' };
    }
    const segment = outcome.segmentStatus;
    if (segment === undefined || segment === null) {
      return { verdict: 'offline', ok: false, transport: 'hls', detail: 'The channel listing loaded, but its video could not be fetched.' };
    }
    if (segment === 401 || segment === 403) {
      return { verdict: 'unauthorized', ok: false, transport: 'hls', detail: `The listing loaded but the video was refused (${segment}). The subscription probably does not cover this channel.` };
    }
    if (segment < 200 || segment >= 300) {
      return { verdict: 'offline', ok: false, transport: 'hls', detail: `The channel is listed but its video answered ${segment}.` };
    }
    if ((outcome.segmentBytes ?? 0) === 0) {
      return { verdict: 'offline', ok: false, transport: 'hls', detail: 'The channel is listed but sent no video.' };
    }
    return { verdict: 'working', ok: true, transport: 'hls', detail: 'Playing — HLS video is streaming.' };
  }

  // A 200 that is neither: almost always an HTML page saying the account is
  // over its limit, which is worth reporting as itself rather than as "failed".
  const text = new TextDecoder().decode(head.subarray(0, 200)).trim();
  const html = /^<!doctype html|^<html/i.test(text);
  return {
    verdict: 'unplayable',
    ok: false,
    transport: null,
    detail: html
      ? 'The provider returned a web page instead of video, which usually means the account is blocked or over its device limit.'
      : 'The provider returned data that is not video.',
  };
}

export interface CheckTarget {
  id: string;
  name: string;
  group: string;
}

export interface RunOptions {
  /** Providers rate-limit and count concurrent streams; a handful at a time is plenty. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Runs probes over a worker pool.
 *
 * Concurrency is capped low on purpose. Many panels count simultaneous
 * connections against the subscription's device limit, so a fast wide sweep
 * would make working channels report as refused — the check would cause the
 * failure it is meant to detect.
 */
export async function runChecks(
  targets: readonly CheckTarget[],
  probe: (target: CheckTarget) => Promise<ProbeOutcome>,
  options: RunOptions = {},
): Promise<ChannelCheck[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 16));
  const results: ChannelCheck[] = new Array<ChannelCheck>(targets.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (options.signal?.aborted === true) return;
      const index = next;
      next += 1;
      const target = targets[index];
      if (target === undefined) return;
      const started = Date.now();
      let outcome: ProbeOutcome;
      try {
        outcome = await probe(target);
      } catch (error) {
        outcome = { status: null, networkError: error instanceof Error ? error.message : 'failed' };
      }
      results[index] = {
        id: target.id,
        name: target.name,
        group: target.group,
        status: outcome.status,
        ms: Date.now() - started,
        ...classify(outcome),
      };
      done += 1;
      options.onProgress?.(done, targets.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results.filter((entry) => entry !== undefined);
}

export function summarize(results: readonly ChannelCheck[]): Record<ChannelVerdict, number> {
  const counts: Record<ChannelVerdict, number> = {
    working: 0, unauthorized: 0, missing: 0, offline: 0, silent: 0, empty: 0, unplayable: 0, unreachable: 0,
  };
  for (const entry of results) counts[entry.verdict] += 1;
  return counts;
}

/**
 * One line a person can act on, from a whole run.
 *
 * This is the answer to "is Live TV working?", and it distinguishes the two
 * cases that look identical in a channel list: nothing works because the
 * subscription is refused, and nothing works because those channels are dead.
 */
export function verdictLine(report: Pick<LiveCheckReport, 'checked' | 'working' | 'results'>): string {
  if (report.checked === 0) return 'No channels were checked.';
  const counts = summarize(report.results);
  if (report.working === report.checked) return `Live TV is working. All ${report.checked} channels checked are streaming.`;
  if (report.working > 0) {
    const dead = report.checked - report.working;
    const silent = counts.silent + counts.offline;
    const because = silent === dead
      ? `the other ${dead} are listed but not broadcasting`
      : `the other ${dead} are dead entries on the provider's side`;
    return `Live TV is working. ${report.working} of ${report.checked} channels checked are streaming; ${because}, which is normal for a list this size.`;
  }
  if (counts.unauthorized > 0) {
    return `Live TV is not working: the provider refused every channel checked. The subscription, username or password is being rejected, or too many devices are already streaming.`;
  }
  if (counts.unreachable === report.checked) {
    return 'Live TV is not working: the provider could not be reached at all. Check the connection and the panel address.';
  }
  if (counts.silent + counts.offline === report.checked) {
    return `None of the ${report.checked} channels checked are broadcasting right now. The provider answered, so the connection and subscription are fine — try a different group.`;
  }
  return `Live TV is not working: none of the ${report.checked} channels checked returned video.`;
}
