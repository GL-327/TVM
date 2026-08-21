import { beforeEach, describe, expect, it } from 'vitest';
import { SEEK_HOLD_SECONDS, SEEK_TAP_SECONDS, seekBy } from './SeekSkip';

class FakeHTMLElement {}
class FakeHTMLVideoElement extends FakeHTMLElement {}

const runtime = globalThis as typeof globalThis & {
  HTMLElement: typeof FakeHTMLElement;
  HTMLVideoElement: typeof FakeHTMLVideoElement;
  window?: typeof globalThis;
  document?: unknown;
  dispatchEvent?: (event: unknown) => boolean;
  CustomEvent?: typeof CustomEvent;
};

runtime.HTMLElement = FakeHTMLElement as unknown as typeof HTMLElement;
runtime.HTMLVideoElement = FakeHTMLVideoElement as unknown as typeof HTMLVideoElement;

type FakeVideo = FakeHTMLVideoElement & {
  currentTime: number;
  duration: number;
  readyState: number;
  seekable: { length: number };
  isConnected: boolean;
  querySelector: (selector: string) => FakeVideo | null;
  getAttribute: () => null;
};

function installPlayerDom(currentTime = 40, duration = 200): FakeVideo {
  const video = Object.assign(new FakeHTMLVideoElement(), {
    currentTime,
    duration,
    readyState: 4,
    seekable: { length: 1 },
    isConnected: true,
    querySelector(selector: string) {
      return /video/.test(selector) ? video : null;
    },
    getAttribute() {
      return null;
    },
  }) as FakeVideo;

  const document = {
    querySelector(selector: string) {
      if (/modal-layer|data-player-menu|data-picker|role="menu"|chrome--hidden/.test(selector)) return null;
      return video;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    },
    createElement() {
      return { id: '', textContent: '' };
    },
    head: { appendChild() {} },
    body: {},
    activeElement: null,
  };

  runtime.document = document as unknown as Document;
  runtime.window = globalThis as Window & typeof globalThis;
  if (typeof runtime.dispatchEvent !== 'function') {
    runtime.dispatchEvent = () => true;
  }
  if (typeof runtime.CustomEvent !== 'function') {
    runtime.CustomEvent = class CustomEvent {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    } as typeof CustomEvent;
  }

  return video;
}

describe('seekBy', () => {
  let video: FakeVideo;

  beforeEach(() => {
    video = installPlayerDom();
  });

  it('rejects zero and non-finite deltas', () => {
    expect(seekBy(0)).toBe(false);
    expect(seekBy(Number.NaN)).toBe(false);
    expect(video.currentTime).toBe(40);
  });

  it('skips forward by the tap amount', () => {
    expect(SEEK_TAP_SECONDS).toBe(10);
    expect(seekBy(SEEK_TAP_SECONDS)).toBe(true);
    expect(video.currentTime).toBe(50);
  });

  it('clamps rewind at the start', () => {
    video.currentTime = 4;
    expect(seekBy(-SEEK_TAP_SECONDS)).toBe(true);
    expect(video.currentTime).toBe(0);
  });

  it('clamps a long skip at duration', () => {
    video.currentTime = 185;
    expect(SEEK_HOLD_SECONDS).toBe(30);
    expect(seekBy(SEEK_HOLD_SECONDS)).toBe(true);
    expect(video.currentTime).toBe(200);
  });
});
