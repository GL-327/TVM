import type Hls from 'hls.js';

/** The engine publishes its instance; controls never patch a library prototype. */
export const HLS_INSTANCE_CHANGE = 'tvm:hls-instance-change';
const instances = new WeakMap<HTMLMediaElement, Hls>();

export function attachedHls(video: HTMLMediaElement | null): Hls | null {
  return video === null ? null : instances.get(video) ?? null;
}

export function publishHls(video: HTMLMediaElement, instance: Hls | null): void {
  if (instance === null) instances.delete(video);
  else instances.set(video, instance);
  video.dispatchEvent(new Event(HLS_INSTANCE_CHANGE, { bubbles: true }));
}
