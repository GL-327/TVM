import { useEffect, type RefObject } from 'react';
import {
  applyBackdropLuminance,
  GLASS_RECIPE,
  sampleRgbaLuminance,
} from '../theme/glass';

/**
 * Liquid Glass refraction, pointer specular bloom, and backdrop luminance sampling
 * for the web interface, matching the Windows Direct2D lens (`native/src/platform/glass_lens.cpp`).
 *
 * Each glass surface is a flat slab whose edge rolls over in a convex bezel (22% of the short side,
 * capped at 18px). Only the bezel bends light: the centre stays clear (3px blur for chrome, 7px for
 * large sheets, saturate 1.65, slight luminance lift), while the rim pulls in a compressed ring of
 * what lies behind it with sub-pixel (<1px) chromatic dispersion.
 *
 * Chromium / WebView2 / Android WebView render the SVG `feDisplacementMap` inside `backdrop-filter`;
 * Safari / WKWebView / Firefox fall back to the CSS blur/saturate + specular rim.
 */

export interface LensGeometry {
  /** Width of the convex bezel, in CSS pixels. */
  bevel: number;
  /** How far the rim pixel samples inward, in CSS pixels. */
  amount: number;
}

export interface LensMap {
  width: number;
  height: number;
  /** RGBA bytes: red carries horizontal shift and green vertical shift around mid-grey (128). */
  data: Uint8ClampedArray<ArrayBuffer>;
  /** The `feDisplacementMap` scale that turns encoded bytes back into CSS pixels. */
  scale: number;
}

export interface LensOptions {
  /** Standard deviation of the diffusion under the glass, in CSS pixels. */
  blur?: number;
  active?: boolean;
  /** Colour lift behind the glass. */
  saturate?: number;
}

const BEVEL_FRACTION = GLASS_RECIPE.bevelFractionOfHalf; // 0.44 of half = 22% of short side
const MIN_BEVEL = GLASS_RECIPE.minBevelPx;
const MAX_BEVEL = GLASS_RECIPE.maxBevelPx;
const SHIFT_PER_BEVEL = GLASS_RECIPE.shiftPerBevel;
const MAX_CACHE_ENTRIES = 64;

const GLASS_SELECTOR = '.glass, .tvm-button--glass, .glass-segment, .player-frost, [data-glass-lens]';
const SOLID_EXCLUSION_SELECTOR =
  '.polish-nav__capsule, .stats-card, .whats-new-release, .rd-card, .setup-card, .profile-editor, [data-glass-solid="true"]';
const SHEET_SELECTOR =
  '.glass--sheet, .glass--card, .search-pill__panel, .patch-notes__sheet, .trailer-sheet, .pin-sheet, .changelog-card, .polish-nav__menu';
const BACKDROP_ART_SELECTOR =
  'img.stage__art.art--ready, .spotlight__media img.stage__art, .details__stage img, .details__backdrop img, img.details__backdrop, .ambient-backdrop img, [data-backdrop-art] img, img[data-backdrop-art]';

export function lensGeometry(width: number, height: number): LensGeometry {
  const half = Math.min(width, height) / 2;
  const bevel = Math.min(
    Math.max(BEVEL_FRACTION * half, Math.min(MIN_BEVEL, half)),
    Math.min(MAX_BEVEL, half),
  );
  return {
    bevel: +bevel.toFixed(4),
    amount: +Math.min(SHIFT_PER_BEVEL * bevel, 0.9 * half).toFixed(4),
  };
}

/** Signed distance from a point (relative to the centre) to a rounded box, and its outward normal. */
function roundedBox(px: number, py: number, hx: number, hy: number, r: number): [number, number, number] {
  const qx = Math.abs(px) - (hx - r);
  const qy = Math.abs(py) - (hy - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const sdf = outside + Math.min(Math.max(qx, qy), 0) - r;

  // Inflate the corner radius slightly when computing normals (Kyant0 fit) so corner
  // refraction transitions smoothly instead of creasing along a 45-degree diagonal.
  const nr = Math.min(Math.min(hx, hy), Math.max(r * 1.25, r + 2));
  const nqx = Math.abs(px) - (hx - nr);
  const nqy = Math.abs(py) - (hy - nr);
  let nx = 0;
  let ny = 0;
  if (nqx > 0 && nqy > 0) {
    const length = Math.hypot(nqx, nqy);
    nx = Math.sign(px) * (nqx / length);
    ny = Math.sign(py) * (nqy / length);
  } else if (nqx > nqy) {
    nx = px < 0 ? -1 : 1;
  } else {
    ny = py < 0 ? -1 : 1;
  }
  return [sdf, nx, ny];
}

/** The displacement map for a surface `width` x `height` with corner `radius`, all in CSS pixels. */
export function buildLensMap(width: number, height: number, radius: number): LensMap {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const hx = w / 2;
  const hy = h / 2;
  const r = Math.min(Math.max(radius, 0), Math.min(hx, hy));
  const { bevel, amount } = lensGeometry(w, h);
  const scale = Math.max(1, 2 * amount);
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const [sdf, nx, ny] = roundedBox(x + 0.5 - hx, y + 0.5 - hy, hx, hy, r);
      let dx = 0;
      let dy = 0;
      const depth = -sdf;
      if (depth > 0 && depth < bevel) {
        // Quarter-circle convex bezel slope: 0 at inner end of bezel, full inward shift at rim.
        const rimward = Math.min(Math.max(1 - depth / bevel, 0), 1);
        const shift = amount * (1 - Math.sqrt(1 - rimward * rimward));
        dx = -shift * nx;
        dy = -shift * ny;
      }
      data[i] = Math.round(255 * (0.5 + dx / scale));
      data[i + 1] = Math.round(255 * (0.5 + dy / scale));
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data, scale };
}

/** True where `backdrop-filter: url(#…)` refracts: Chromium, excluding iOS/iPadOS WebKit shells. */
export function lensSupported(userAgent: string, maxTouchPoints = 0): boolean {
  if (!/Chrome\/\d+|Chromium\/\d+|Edg\/\d+/.test(userAgent)) return false;
  if (/iPhone|iPad|iPod|CriOS|EdgiOS/.test(userAgent)) return false;
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return false;
  return true;
}

export function lensAllowed(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!lensSupported(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return false;
  const root = document.documentElement;
  if (root.dataset.perf === 'on' || root.dataset.transparency === 'reduced') return false;
  if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return false;
  return true;
}

interface CachedTexture {
  url: string;
  width: number;
  height: number;
  scale: number;
}

interface LensRecord {
  element: HTMLElement;
  filter: SVGFilterElement | null;
  lastKey: string;
  explicitBlur?: number;
  explicitSaturate?: number;
  explicitActive?: boolean;
  hookManaged: boolean;
}

let lensCount = 0;
const textures = new Map<string, CachedTexture>();
const records = new Map<HTMLElement, LensRecord>();
const dirtyElements = new Set<HTMLElement>();
let sharedResizeObserver: ResizeObserver | null = null;
let domMutationObserver: MutationObserver | null = null;
let rootAttrObserver: MutationObserver | null = null;
let batchFrame = 0;
let pointerFrame = 0;
let pendingPointer: { surface: HTMLElement; clientX: number; clientY: number } | null = null;
let backdropFrame = 0;
let lastSampledArtKey = '';
const sampledUrlCache = new Map<string, number>();
let runtimeStarted = false;

export function getLensCacheSize(): number {
  return textures.size;
}

function svgHost(): SVGSVGElement {
  let host = document.getElementById('tvm-liquid-lenses') as SVGSVGElement | null;
  if (host === null) {
    host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.id = 'tvm-liquid-lenses';
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.style.position = 'absolute';
    host.style.width = '0';
    host.style.height = '0';
    host.style.pointerEvents = 'none';
    document.body.appendChild(host);
  }
  return host;
}

const FALLBACK_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';

function mapDataUrl(map: LensMap): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = map.width;
    canvas.height = map.height;
    const context = canvas.getContext('2d');
    if (context !== null && typeof ImageData !== 'undefined') {
      context.putImageData(new ImageData(map.data, map.width, map.height), 0, 0);
      const url = canvas.toDataURL('image/png');
      if (url.startsWith('data:image/png')) return url;
    }
  } catch {
    // Headless test DOMs without a 2D canvas implementation use the fallback data URI.
  }
  return FALLBACK_DATA_URL;
}

function isEligibleGlassSurface(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  if (element.matches(SOLID_EXCLUSION_SELECTOR)) return false;
  return element.matches(GLASS_SELECTOR);
}

function resolveBlurForElement(record: LensRecord): number {
  if (record.explicitBlur !== undefined) return record.explicitBlur;
  return record.element.matches(SHEET_SELECTOR)
    ? GLASS_RECIPE.sheetBlurPx
    : GLASS_RECIPE.chromeBlurPx;
}

function resolveSaturateForElement(record: LensRecord): number {
  return record.explicitSaturate ?? GLASS_RECIPE.saturate;
}

function detachRecordFilter(record: LensRecord): void {
  record.lastKey = '';
  record.filter?.remove();
  record.filter = null;
  record.element.style.removeProperty('backdrop-filter');
  record.element.style.removeProperty('-webkit-backdrop-filter');
  delete record.element.dataset.lens;
}

function removeRecord(element: HTMLElement): void {
  const record = records.get(element);
  if (!record) return;
  dirtyElements.delete(element);
  sharedResizeObserver?.unobserve(element);
  detachRecordFilter(record);
  records.delete(element);
}

function flushDirtyLenses(): void {
  batchFrame = 0;
  if (typeof document === 'undefined') return;
  const allowed = lensAllowed();
  if (!allowed) {
    dirtyElements.clear();
    for (const record of records.values()) {
      detachRecordFilter(record);
    }
    return;
  }

  const targets = Array.from(dirtyElements);
  dirtyElements.clear();

  // Phase 1: Batch all DOM geometry and computed style reads together to avoid layout thrash.
  const measurements: Array<{
    record: LensRecord;
    width: number;
    height: number;
    radius: number;
    blur: number;
    saturate: number;
  }> = [];

  for (const element of targets) {
    const record = records.get(element);
    if (!record) continue;
    if (!element.isConnected || record.explicitActive === false || (!record.hookManaged && !isEligibleGlassSurface(element))) {
      detachRecordFilter(record);
      continue;
    }
    let width = Math.round(element.offsetWidth);
    let height = Math.round(element.offsetHeight);
    if ((width < 8 || height < 8) && typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height);
    }
    if (width < 8 || height < 8) continue;
    const style = getComputedStyle(element);
    const parsedRadius = Number.parseFloat(style.borderTopLeftRadius);
    const radius = Number.isFinite(parsedRadius)
      ? Math.min(Math.round(parsedRadius), Math.floor(Math.min(width, height) / 2))
      : 12;
    const blur = resolveBlurForElement(record);
    const saturate = resolveSaturateForElement(record);
    measurements.push({ record, width, height, radius, blur, saturate });
  }

  // Phase 2: Batch all SVG filter mutations and inline style writes.
  const svgNs = 'http://www.w3.org/2000/svg';
  for (const { record, width, height, radius, blur, saturate } of measurements) {
    const sizeKey = `${width}x${height}r${radius}`;
    const fullKey = `${sizeKey}:b${blur}:s${saturate}`;
    if (record.lastKey === fullKey && record.filter !== null) continue;
    record.lastKey = fullKey;

    let texture = textures.get(sizeKey);
    if (!texture) {
      const map = buildLensMap(width, height, radius);
      const url = mapDataUrl(map);
      texture = { url, width: map.width, height: map.height, scale: map.scale };
      if (textures.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = textures.keys().next().value;
        if (oldestKey !== undefined) textures.delete(oldestKey);
      }
      textures.set(sizeKey, texture);
    } else {
      // Refresh LRU order.
      textures.delete(sizeKey);
      textures.set(sizeKey, texture);
    }

    if (!record.filter) {
      lensCount += 1;
      const filter = document.createElementNS(svgNs, 'filter');
      filter.id = `tvm-lens-${lensCount}`;
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.setAttribute('filterUnits', 'objectBoundingBox');
      filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
      filter.setAttribute('x', '0%');
      filter.setAttribute('y', '0%');
      filter.setAttribute('width', '100%');
      filter.setAttribute('height', '100%');
      svgHost().appendChild(filter);
      record.filter = filter;
    }

    // Sub-pixel chromatic dispersion (<1px) along the strongly bent bezel only.
    const dispersion = Math.min(
      GLASS_RECIPE.dispersionMaxPx,
      Math.max(0.25, +(texture.scale * GLASS_RECIPE.dispersionRatio).toFixed(2)),
    );
    const rScale = (texture.scale + dispersion).toFixed(2);
    const gScale = texture.scale.toFixed(2);
    const bScale = Math.max(0.5, texture.scale - dispersion).toFixed(2);
    const lift = GLASS_RECIPE.brightnessLift.toFixed(2);

    record.filter.innerHTML =
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" edgeMode="duplicate" result="diffused"/>` +
      `<feImage href="${texture.url}" x="0" y="0" width="${texture.width}" height="${texture.height}" preserveAspectRatio="none" result="lens"/>` +
      `<feDisplacementMap in="diffused" in2="lens" scale="${rScale}" xChannelSelector="R" yChannelSelector="G" result="dispR"/>` +
      `<feColorMatrix in="dispR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>` +
      `<feDisplacementMap in="diffused" in2="lens" scale="${gScale}" xChannelSelector="R" yChannelSelector="G" result="dispG"/>` +
      `<feColorMatrix in="dispG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>` +
      `<feDisplacementMap in="diffused" in2="lens" scale="${bScale}" xChannelSelector="R" yChannelSelector="G" result="dispB"/>` +
      `<feColorMatrix in="dispB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>` +
      `<feBlend in="r" in2="g" mode="screen" result="rg"/>` +
      `<feBlend in="rg" in2="b" mode="screen" result="bent"/>` +
      `<feColorMatrix in="bent" type="saturate" values="${saturate}" result="vibrant"/>` +
      `<feComponentTransfer in="vibrant">` +
      `<feFuncR type="linear" slope="${lift}"/>` +
      `<feFuncG type="linear" slope="${lift}"/>` +
      `<feFuncB type="linear" slope="${lift}"/>` +
      `</feComponentTransfer>`;

    const filterUrl = `url(#${record.filter.id})`;
    record.element.style.setProperty('backdrop-filter', filterUrl);
    record.element.style.setProperty('-webkit-backdrop-filter', filterUrl);
    record.element.dataset.lens = 'on';
  }
}

function scheduleFlush(element?: HTMLElement): void {
  if (element) dirtyElements.add(element);
  if (batchFrame !== 0 || typeof requestAnimationFrame !== 'function') {
    if (typeof requestAnimationFrame !== 'function') flushDirtyLenses();
    return;
  }
  batchFrame = requestAnimationFrame(flushDirtyLenses);
}

function registerGlassElement(element: HTMLElement, options?: LensOptions, hookManaged = false): LensRecord {
  let record = records.get(element);
  if (!record) {
    record = {
      element,
      filter: null,
      lastKey: '',
      hookManaged,
    };
    records.set(element, record);
    sharedResizeObserver?.observe(element);
  }
  if (hookManaged) record.hookManaged = true;
  if (options) {
    if (options.blur !== undefined) record.explicitBlur = options.blur;
    if (options.saturate !== undefined) record.explicitSaturate = options.saturate;
    if (options.active !== undefined) record.explicitActive = options.active;
  }
  scheduleFlush(element);
  return record;
}

function scanSubtreeForGlass(root: ParentNode): void {
  if (root instanceof HTMLElement && isEligibleGlassSurface(root)) {
    registerGlassElement(root);
  }
  if (typeof root.querySelectorAll === 'function') {
    const matches = root.querySelectorAll<HTMLElement>(GLASS_SELECTOR);
    matches.forEach((node) => {
      if (isEligibleGlassSurface(node)) registerGlassElement(node);
    });
  }
}

function pruneDisconnectedRecords(): void {
  for (const [element, record] of records.entries()) {
    if (!element.isConnected) {
      removeRecord(element);
    } else if (!record.hookManaged && !isEligibleGlassSurface(element)) {
      removeRecord(element);
    }
  }
}

/**
 * Samples the active hero/backdrop image once per artwork change onto a tiny 16x16
 * canvas and updates the adaptive glass tint and contrast-verified text tokens.
 */
function sampleActiveBackdrop(): void {
  backdropFrame = 0;
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const explicitRootLuma = root.dataset.backdropLuma;
  if (explicitRootLuma !== undefined && explicitRootLuma !== '') {
    const parsed = Number.parseFloat(explicitRootLuma);
    if (Number.isFinite(parsed)) {
      applyBackdropLuminance(parsed, root);
      return;
    }
  }

  const ExplicitContainer = document.querySelector<HTMLElement>('[data-backdrop-luma]');
  if (ExplicitContainer && ExplicitContainer !== root) {
    const parsed = Number.parseFloat(ExplicitContainer.dataset.backdropLuma ?? '');
    if (Number.isFinite(parsed)) {
      applyBackdropLuminance(parsed, root);
      return;
    }
  }

  const artImages = Array.from(document.querySelectorAll<HTMLImageElement>(BACKDROP_ART_SELECTOR));
  const activeImg = artImages.find((img) => img.isConnected && img.complete && img.naturalWidth > 0) ?? artImages[0];
  const src = activeImg?.currentSrc || activeImg?.getAttribute('src') || '';
  const theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  const artKey = `${theme}:${src}:${activeImg?.complete ? '1' : '0'}`;
  if (artKey === lastSampledArtKey) return;
  lastSampledArtKey = artKey;

  if (!activeImg || !src) {
    applyBackdropLuminance(theme === 'light' ? 0.88 : 0.10, root);
    return;
  }

  const cached = sampledUrlCache.get(src);
  if (cached !== undefined) {
    applyBackdropLuminance(cached, root);
    return;
  }

  const measureImageElement = (img: HTMLImageElement): number | null => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, 16, 16);
      const pixels = ctx.getImageData(0, 0, 16, 16).data;
      return sampleRgbaLuminance(pixels, 16, 16);
    } catch {
      return null;
    }
  };

  if (activeImg.complete && activeImg.naturalWidth > 0) {
    const luma = measureImageElement(activeImg);
    if (luma !== null) {
      sampledUrlCache.set(src, luma);
      applyBackdropLuminance(luma, root);
      return;
    }
    // Retry once with an anonymous CORS image for cross-origin artwork CDNs.
    if (!src.startsWith('data:')) {
      const corsImg = new Image();
      corsImg.crossOrigin = 'anonymous';
      corsImg.onload = () => {
        const corsLuma = measureImageElement(corsImg);
        if (corsLuma !== null) {
          sampledUrlCache.set(src, corsLuma);
          if (lastSampledArtKey.includes(src)) applyBackdropLuminance(corsLuma, root);
        }
      };
      corsImg.src = src;
    }
  }

  applyBackdropLuminance(theme === 'light' ? 0.88 : 0.10, root);
}

function scheduleBackdropSample(): void {
  if (backdropFrame !== 0 || typeof requestAnimationFrame !== 'function') return;
  backdropFrame = requestAnimationFrame(sampleActiveBackdrop);
}

function onDocumentPointerMove(event: PointerEvent): void {
  if (event.pointerType === 'touch') return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const surface = target.closest<HTMLElement>(GLASS_SELECTOR);
  if (!surface || surface.matches(SOLID_EXCLUSION_SELECTOR)) return;
  pendingPointer = { surface, clientX: event.clientX, clientY: event.clientY };
  if (pointerFrame !== 0) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    const current = pendingPointer;
    pendingPointer = null;
    if (!current || !current.surface.isConnected) return;
    const rect = current.surface.getBoundingClientRect();
    current.surface.style.setProperty('--glass-x', `${Math.round(current.clientX - rect.left)}px`);
    current.surface.style.setProperty('--glass-y', `${Math.round(current.clientY - rect.top)}px`);
  });
}

function onDocumentMediaLoad(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLImageElement && target.matches(BACKDROP_ART_SELECTOR)) {
    lastSampledArtKey = '';
    scheduleBackdropSample();
  }
}

export function syncAllGlassSurfaces(): void {
  if (typeof document === 'undefined' || !document.body) return;
  pruneDisconnectedRecords();
  scanSubtreeForGlass(document.body);
  for (const element of records.keys()) {
    dirtyElements.add(element);
  }
  flushDirtyLenses();
  lastSampledArtKey = '';
  sampleActiveBackdrop();
}

/**
 * Starts the document-wide Liquid Glass runtime (auto-lensing every `.glass` / `.tvm-button--glass`
 * surface, batched ResizeObserver, desktop pointer specular bloom, and backdrop luminance sampler).
 */
export function ensureLiquidGlassRuntime(): void {
  if (runtimeStarted || typeof window === 'undefined' || typeof document === 'undefined') return;
  runtimeStarted = true;

  if (typeof ResizeObserver !== 'undefined') {
    sharedResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement && records.has(entry.target)) {
          dirtyElements.add(entry.target);
        }
      }
      scheduleFlush();
    });
  }

  if (typeof MutationObserver !== 'undefined') {
    domMutationObserver = new MutationObserver((mutations) => {
      let needsPrune = false;
      let artChanged = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              scanSubtreeForGlass(node);
              if (node.matches?.(BACKDROP_ART_SELECTOR) || node.querySelector?.(BACKDROP_ART_SELECTOR)) {
                artChanged = true;
              }
            }
          });
          if (mutation.removedNodes.length > 0) needsPrune = true;
        } else if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
          const target = mutation.target;
          if (mutation.attributeName === 'data-backdrop-luma' || target.matches(BACKDROP_ART_SELECTOR)) {
            artChanged = true;
          }
          if (isEligibleGlassSurface(target)) {
            registerGlassElement(target);
          } else if (records.has(target) && !records.get(target)?.hookManaged) {
            removeRecord(target);
          }
        }
      }
      if (needsPrune) pruneDisconnectedRecords();
      if (artChanged) {
        lastSampledArtKey = '';
        scheduleBackdropSample();
      }
    });

    const startObservingBody = (): void => {
      if (!document.body) return;
      domMutationObserver?.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'data-glass-lens', 'data-glass-solid', 'data-backdrop-luma', 'src'],
      });
      syncAllGlassSurfaces();
    };

    if (document.body) startObservingBody();
    else window.addEventListener('DOMContentLoaded', startObservingBody, { once: true });

    rootAttrObserver = new MutationObserver(() => {
      syncAllGlassSurfaces();
    });
    rootAttrObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-transparency', 'data-perf', 'data-theme', 'data-backdrop-luma'],
    });
  }

  window.addEventListener('tvm:appearance', syncAllGlassSurfaces);
  document.addEventListener('pointermove', onDocumentPointerMove, { passive: true });
  document.addEventListener('load', onDocumentMediaLoad, true);
}

/**
 * Bends the backdrop of the element at `ref` through a Liquid Glass lens of its own size and corner radius,
 * where the browser supports SVG `backdrop-filter`.
 */
export function useLiquidLens(ref: RefObject<HTMLElement | null>, options: LensOptions = {}): void {
  const { blur, saturate = GLASS_RECIPE.saturate, active = true } = options;
  useEffect(() => {
    ensureLiquidGlassRuntime();
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;

    const surface = element.closest<HTMLElement>('.glass, .tvm-button--glass') ?? element;
    const shine = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty('--glass-x', `${Math.round(event.clientX - rect.left)}px`);
      surface.style.setProperty('--glass-y', `${Math.round(event.clientY - rect.top)}px`);
    };
    surface.addEventListener('pointermove', shine, { passive: true });

    const record = registerGlassElement(element, { blur, saturate, active }, true);
    if (!active) {
      detachRecordFilter(record);
    } else {
      flushDirtyLenses();
    }

    return () => {
      surface.removeEventListener('pointermove', shine);
      record.hookManaged = false;
      record.explicitActive = undefined;
      record.explicitBlur = undefined;
      record.explicitSaturate = undefined;
      if (!isEligibleGlassSurface(element)) {
        removeRecord(element);
      } else {
        scheduleFlush(element);
      }
    };
  }, [ref, blur, saturate, active]);
}
