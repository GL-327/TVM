/**
 * Moves an MPEG-TS clip along the timeline.
 *
 * The tester loops three short H.264 segments forever. Played back as they
 * are, every loop would jump the clock back to the start, which a player
 * treats as a broken stream unless the playlist marks a discontinuity — and a
 * raw `.ts` channel has no playlist to mark it in. Shifting every timestamp
 * by the loop offset makes the loop indistinguishable from a real live
 * channel: PTS and DTS on each PES header, the PCR in each adaptation field,
 * and the continuity counter on each packet all run on without a break.
 */

export const TS_PACKET = 188;
const SYNC = 0x47;
const CLOCK = 90_000;
const WRAP = 2 ** 33;

function read33(bytes: Uint8Array, at: number): number {
  // PTS/DTS layout: 4 marker bits, 3 bits, marker, 15 bits, marker, 15 bits, marker.
  return (
    ((bytes[at]! >> 1) & 0x07) * 2 ** 30 +
    (bytes[at + 1]! << 22) +
    ((bytes[at + 2]! >> 1) << 15) +
    (bytes[at + 3]! << 7) +
    (bytes[at + 4]! >> 1)
  );
}

function write33(bytes: Uint8Array, at: number, value: number): void {
  const prefix = bytes[at]! & 0xf0;
  const high = Math.floor(value / 2 ** 30) & 0x07;
  const low = value % 2 ** 30;
  bytes[at] = prefix | (high << 1) | 0x01;
  bytes[at + 1] = (low >> 22) & 0xff;
  bytes[at + 2] = (((low >> 15) & 0x7f) << 1) | 0x01;
  bytes[at + 3] = (low >> 7) & 0xff;
  bytes[at + 4] = ((low & 0x7f) << 1) | 0x01;
}

function shift(value: number, by: number): number {
  return ((value + by) % WRAP + WRAP) % WRAP;
}

/** Continuity counters per PID, carried from one rewritten clip to the next. */
export type ContinuityState = Map<number, number>;

/**
 * Returns a copy of `clip` with every clock moved on by `offsetSeconds`.
 *
 * `continuity`, when given, renumbers each packet's continuity counter so it
 * follows on from the previous clip written with the same state.
 */
export function shiftTimestamps(clip: Uint8Array, offsetSeconds: number, continuity?: ContinuityState): Uint8Array {
  const out = new Uint8Array(clip);
  const by = Math.round(offsetSeconds * CLOCK);
  for (let at = 0; at + TS_PACKET <= out.length; at += TS_PACKET) {
    if (out[at] !== SYNC) continue;
    const pid = ((out[at + 1]! & 0x1f) << 8) | out[at + 2]!;
    const unitStart = (out[at + 1]! & 0x40) !== 0;
    const control = (out[at + 3]! >> 4) & 0x03;
    const hasPayload = (control & 0x01) !== 0;
    let payload = at + 4;

    if (continuity !== undefined && hasPayload && pid !== 0x1fff) {
      const next = ((continuity.get(pid) ?? -1) + 1) & 0x0f;
      continuity.set(pid, next);
      out[at + 3] = (out[at + 3]! & 0xf0) | next;
    }

    if ((control & 0x02) !== 0) {
      const length = out[at + 4]!;
      if (length > 0 && (out[at + 5]! & 0x10) !== 0 && length >= 7) {
        // PCR: 33-bit base, 6 reserved bits, 9-bit extension.
        const base =
          out[at + 6]! * 2 ** 25 + (out[at + 7]! << 17) + (out[at + 8]! << 9) + (out[at + 9]! << 1) + (out[at + 10]! >> 7);
        const moved = shift(base, by);
        const extension = ((out[at + 10]! & 0x01) << 8) | out[at + 11]!;
        out[at + 6] = Math.floor(moved / 2 ** 25) & 0xff;
        out[at + 7] = Math.floor(moved / 2 ** 17) & 0xff;
        out[at + 8] = Math.floor(moved / 2 ** 9) & 0xff;
        out[at + 9] = Math.floor(moved / 2) & 0xff;
        out[at + 10] = ((moved % 2) << 7) | 0x7e | ((extension >> 8) & 0x01);
        out[at + 11] = extension & 0xff;
      }
      payload = at + 5 + length;
    }

    if (!unitStart || !hasPayload || payload + 14 > at + TS_PACKET) continue;
    if (out[payload] !== 0 || out[payload + 1] !== 0 || out[payload + 2] !== 1) continue;
    const stream = out[payload + 3]!;
    // Audio and video elementary streams carry the optional PES header.
    if (stream < 0xc0 || stream > 0xef) continue;
    const flags = out[payload + 7]! >> 6;
    if ((flags & 0x02) !== 0) write33(out, payload + 9, shift(read33(out, payload + 9), by));
    if (flags === 0x03 && payload + 19 <= at + TS_PACKET) write33(out, payload + 14, shift(read33(out, payload + 14), by));
  }
  return out;
}

/** Every PTS in a clip, in seconds, for tests and diagnostics. */
export function presentationTimes(clip: Uint8Array): number[] {
  const times: number[] = [];
  for (let at = 0; at + TS_PACKET <= clip.length; at += TS_PACKET) {
    if (clip[at] !== SYNC || (clip[at + 1]! & 0x40) === 0) continue;
    const control = (clip[at + 3]! >> 4) & 0x03;
    if ((control & 0x01) === 0) continue;
    const payload = (control & 0x02) !== 0 ? at + 5 + clip[at + 4]! : at + 4;
    if (payload + 14 > at + TS_PACKET) continue;
    if (clip[payload] !== 0 || clip[payload + 1] !== 0 || clip[payload + 2] !== 1) continue;
    const stream = clip[payload + 3]!;
    if (stream < 0xc0 || stream > 0xef || ((clip[payload + 7]! >> 6) & 0x02) === 0) continue;
    times.push(read33(clip, payload + 9) / CLOCK);
  }
  return times;
}
