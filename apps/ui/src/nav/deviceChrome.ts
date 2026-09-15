/**
 * Phone chrome: notch / Dynamic Island / home-button bezels, and the
 * playback height that hardware can actually show.
 *
 * Native iOS publishes `window.__tvmDevice` from UIKit safe-area insets
 * (apps/ios TVMDeviceChrome.swift). This module is the shared copy so a
 * browser preview and Android still classify the screen when that payload
 * is missing. CSS reads `--tvm-inset-*` and `data-device-family`.
 */

export type DeviceFamily = 'home-button' | 'notch' | 'island' | 'ipad' | 'unknown';
export type DeviceMaxHeight = 720 | 1080 | 2160;

export interface DeviceChrome {
  identifier: string;
  model: string;
  family: DeviceFamily;
  maxHeight: DeviceMaxHeight;
  insetTop: number;
  insetRight: number;
  insetBottom: number;
  insetLeft: number;
  extraTop: number;
  extraBottom: number;
  extraX: number;
}

export const DEVICE_EVENT = 'tvm:device-chrome';

const FAMILIES: readonly DeviceFamily[] = ['home-button', 'notch', 'island', 'ipad', 'unknown'];

declare global {
  interface Window {
    __tvmDevice?: Partial<DeviceChrome>;
    __tvmApplyDevice?: () => void;
  }
}

export function isDeviceFamily(value: unknown): value is DeviceFamily {
  return typeof value === 'string' && (FAMILIES as readonly string[]).includes(value);
}

export function asMaxHeight(value: unknown): DeviceMaxHeight {
  const n = typeof value === 'number' ? value : Number(value);
  if (n >= 2160) return 2160;
  if (n >= 1080) return 1080;
  return 720;
}

export function playbackMaxHeight(planMax: number, deviceMax: number): DeviceMaxHeight {
  return asMaxHeight(Math.min(planMax, deviceMax));
}

/**
 * Classify a phone from CSS insets and the short/long viewport. Used when
 * native has not injected a model yet (WKWebView first paint, Android).
 *
 * Island insets sit around 54–62px; notch 44–50; home-button ~20.
 * Size fallbacks cover the case where `env(safe-area-inset-*)` is still 0.
 */
export function inferDeviceFamily(input: {
  insetTop: number;
  shortSide: number;
  longSide: number;
  ua?: string;
  tablet?: boolean;
}): DeviceFamily {
  const ua = input.ua ?? '';
  if (input.tablet === true || /iPad|Tablet/i.test(ua)) return 'ipad';
  const top = Number.isFinite(input.insetTop) ? input.insetTop : 0;
  if (top >= 54) return 'island';
  if (top >= 40) return 'notch';
  if (top >= 16) return 'home-button';

  const short = Math.min(input.shortSide, input.longSide);
  const long = Math.max(input.shortSide, input.longSide);
  if (short >= 768) return 'ipad';
  // 14 Pro / 15 / 16 logical widths.
  if (short >= 393 && long >= 852) return 'island';
  if (short >= 390 && long >= 844) return 'notch';
  if (short >= 375 && long >= 812) return 'notch';
  if (short >= 320 && long >= 568) return 'home-button';
  return 'unknown';
}

export function fallbackInsets(family: DeviceFamily): { top: number; bottom: number } {
  if (family === 'island') return { top: 59, bottom: 34 };
  if (family === 'notch') return { top: 47, bottom: 34 };
  if (family === 'home-button') return { top: 20, bottom: 0 };
  if (family === 'ipad') return { top: 24, bottom: 20 };
  return { top: 0, bottom: 0 };
}

export function extrasForFamily(family: DeviceFamily): { extraTop: number; extraBottom: number; extraX: number } {
  if (family === 'island') return { extraTop: 10, extraBottom: 0, extraX: 0 };
  if (family === 'notch') return { extraTop: 6, extraBottom: 0, extraX: 0 };
  if (family === 'home-button') return { extraTop: 0, extraBottom: 6, extraX: 8 };
  if (family === 'ipad') return { extraTop: 4, extraBottom: 0, extraX: 0 };
  return { extraTop: 0, extraBottom: 0, extraX: 0 };
}

export function inferMaxHeight(family: DeviceFamily, shortSide: number, pixelRatio: number): DeviceMaxHeight {
  if (family === 'island' || family === 'ipad') return 2160;
  if (family === 'notch' && shortSide >= 393 && pixelRatio >= 3) return 2160;
  if (family === 'notch') return 1080;
  if (family === 'home-button' && shortSide >= 375) return 1080;
  return 720;
}

export function parseDeviceChrome(raw: Partial<DeviceChrome> | undefined, fallback: DeviceChrome): DeviceChrome {
  const family = isDeviceFamily(raw?.family) ? raw.family : fallback.family;
  return {
    identifier: typeof raw?.identifier === 'string' && raw.identifier !== '' ? raw.identifier : fallback.identifier,
    model: typeof raw?.model === 'string' && raw.model !== '' ? raw.model : fallback.model,
    family,
    maxHeight: raw?.maxHeight !== undefined ? asMaxHeight(raw.maxHeight) : fallback.maxHeight,
    insetTop: finitePx(raw?.insetTop, fallback.insetTop),
    insetRight: finitePx(raw?.insetRight, fallback.insetRight),
    insetBottom: finitePx(raw?.insetBottom, fallback.insetBottom),
    insetLeft: finitePx(raw?.insetLeft, fallback.insetLeft),
    extraTop: finitePx(raw?.extraTop, fallback.extraTop),
    extraBottom: finitePx(raw?.extraBottom, fallback.extraBottom),
    extraX: finitePx(raw?.extraX, fallback.extraX),
  };
}

function finitePx(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function probeEnvInset(side: 'top' | 'right' | 'bottom' | 'left'): number {
  if (typeof document === 'undefined') return 0;
  const node = document.createElement('div');
  node.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;padding-${side}:env(safe-area-inset-${side},0px)`;
  document.documentElement.appendChild(node);
  const value = Number.parseFloat(getComputedStyle(node).getPropertyValue(`padding-${side}`));
  node.remove();
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function probeViewportChrome(): DeviceChrome {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const probe = probeEnvInset('top');
  const family = inferDeviceFamily({
    insetTop: probe,
    shortSide: Math.min(width, height),
    longSide: Math.max(width, height),
    ua: navigator.userAgent,
    tablet: /iPad|Tablet/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(width, height) >= 768),
  });
  const insets = fallbackInsets(family);
  const extra = extrasForFamily(family);
  const short = Math.min(width, height);
  return {
    identifier: 'web',
    model: family,
    family,
    maxHeight: inferMaxHeight(family, short, window.devicePixelRatio || 1),
    insetTop: probe > 0 ? probe : insets.top,
    insetRight: probeEnvInset('right'),
    insetBottom: probeEnvInset('bottom') || insets.bottom,
    insetLeft: probeEnvInset('left'),
    extraTop: extra.extraTop,
    extraBottom: extra.extraBottom,
    extraX: extra.extraX,
  };
}

export function applyDeviceChrome(root: HTMLElement, chrome: DeviceChrome): void {
  root.style.setProperty('--tvm-inset-top', `${Math.round(chrome.insetTop)}px`);
  root.style.setProperty('--tvm-inset-right', `${Math.round(chrome.insetRight)}px`);
  root.style.setProperty('--tvm-inset-bottom', `${Math.round(chrome.insetBottom)}px`);
  root.style.setProperty('--tvm-inset-left', `${Math.round(chrome.insetLeft)}px`);
  root.style.setProperty('--tvm-chrome-extra-top', `${Math.round(chrome.extraTop)}px`);
  root.style.setProperty('--tvm-chrome-extra-bottom', `${Math.round(chrome.extraBottom)}px`);
  root.style.setProperty('--tvm-chrome-extra-x', `${Math.round(chrome.extraX)}px`);
  root.dataset.deviceFamily = chrome.family;
  root.dataset.deviceModel = chrome.model;
  root.classList.toggle('tvm-island', chrome.family === 'island');
  root.classList.toggle('tvm-notch', chrome.family === 'notch');
  root.classList.toggle('tvm-home-button', chrome.family === 'home-button');
  root.classList.toggle('tvm-ipad', chrome.family === 'ipad');
}

let cached: DeviceChrome | null = null;

export function readDeviceChrome(): DeviceChrome {
  if (cached !== null) return cached;
  return probeViewportChrome();
}

export function startDeviceChrome(): () => void {
  const root = document.documentElement;
  const sync = (): void => {
    const probed = probeViewportChrome();
    const next = parseDeviceChrome(window.__tvmDevice, probed);
    cached = next;
    applyDeviceChrome(root, next);
    window.dispatchEvent(new CustomEvent(DEVICE_EVENT, { detail: next }));
  };
  window.__tvmApplyDevice = sync;
  sync();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  return () => {
    window.removeEventListener('resize', sync);
    window.removeEventListener('orientationchange', sync);
    if (window.__tvmApplyDevice === sync) window.__tvmApplyDevice = undefined;
  };
}
