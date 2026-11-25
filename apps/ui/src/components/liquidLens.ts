import { useEffect, type RefObject } from 'react';

/**
 * Liquid Glass refraction for the web interface, the same lens the Windows app draws.
 *
 * A glass surface is a flat sheet whose edge rolls over in a convex bezel. Only the bezel bends light: the middle
 * shows what is behind it undistorted (just diffused), while the rim pulls in a compressed, strongly bent ring of
 * what lies inside it. The numbers follow the open fits of iOS 26/27 glass (Kyant0's Backdrop and the Flutter
 * liquid_glass_renderer): the bezel is half the shorter half-side, at most 24px, and the rim shift is 1.75 times the
 * bezel, never past the middle.
 *
 * Browsers draw it with an SVG filter in `backdrop-filter`, which only Chromium supports (Android's WebView, Chrome,
 * Edge). Safari and Firefox keep the tuned blur from the glass tokens, so nothing breaks where the lens is absent.
 */

export interface LensGeometry {
  /** Width of the bezel, in CSS pixels. */
  bevel: number;
  /** How far the rim pixel samples inward, in CSS pixels. */
  amount: number;
}

export interface LensMap {
  width: number;
  height: number;
  /** RGBA bytes: red carries the horizontal shift and green the vertical, around mid-grey. */
  data: Uint8ClampedArray<ArrayBuffer>;
  /** The `feDisplacementMap` scale that turns the encoded bytes back into pixels. */
  scale: number;
}

const BEVEL_FRACTION = 0.5;
const MIN_BEVEL = 5;
const MAX_BEVEL = 24;
const SHIFT_PER_BEVEL = 1.75;

export function lensGeometry(width: number, height: number): LensGeometry {
  const half = Math.min(width, height) / 2;
  const bevel = Math.min(Math.max(BEVEL_FRACTION * half, Math.min(MIN_BEVEL, half)), Math.min(MAX_BEVEL, half));
  return { bevel, amount: Math.min(SHIFT_PER_BEVEL * bevel, 0.9 * half) };
}

/** Signed distance from a point (relative to the centre) to a rounded box, and its outward normal. */
function roundedBox(px: number, py: number, hx: number, hy: number, r: number): [number, number, number] {
  const qx = Math.abs(px) - (hx - r);
  const qy = Math.abs(py) - (hy - r);
  let nx = 0;
  let ny = 0;
  if (qx > 0 && qy > 0) {
    const length = Math.hypot(qx, qy);
    nx = Math.sign(px) * (qx / length);
    ny = Math.sign(py) * (qy / length);
  } else if (qx > qy) {
    nx = px < 0 ? -1 : 1;
  } else {
    ny = py < 0 ? -1 : 1;
  }
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return [outside + Math.min(Math.max(qx, qy), 0) - r, nx, ny];
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
      if (depth > 0) {
        // The slope of a quarter circle: nothing at the inner end of the bezel, the full shift at the rim.
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

/** True where `backdrop-filter: url(#…)` refracts: Chromium, but not iOS browsers, which are all WebKit. */
export function lensSupported(userAgent: string, maxTouchPoints = 0): boolean {
  if (!/Chrome\/\d+|Chromium\/\d+|Edg\/\d+/.test(userAgent)) return false;
  if (/iPhone|iPad|iPod|CriOS|EdgiOS/.test(userAgent)) return false;
  // iPadOS asks for desktop pages as a Mac with a touch screen.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return false;
  return true;
}

function lensAllowed(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!lensSupported(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return false;
  const root = document.documentElement;
  // Performance mode and Reduce Transparency both ask for the plain material.
  if (root.dataset.perf === 'on') return false;
  if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return false;
  return true;
}

let lensCount = 0;

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

function mapDataUrl(map: LensMap): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.putImageData(new ImageData(map.data, map.width, map.height), 0, 0);
  return canvas.toDataURL('image/png');
}

export interface LensOptions {
  /** Standard deviation of the diffusion under the glass, in CSS pixels. */
  blur?: number;
  /** Colour lift behind the glass. */
  saturate?: number;
}

/**
 * Bends the backdrop of the element at `ref` through a Liquid Glass lens of its own size and corner radius, where the
 * browser can. The element keeps its CSS glass (wash, rim, shadow); only its `backdrop-filter` is replaced.
 */
export function useLiquidLens(ref: RefObject<HTMLElement | null>, options: LensOptions = {}): void {
  const { blur = 4, saturate = 1.75 } = options;
  useEffect(() => {
    const element = ref.current;
    if (element === null || element.closest('.gate') !== null || !lensAllowed() || typeof ResizeObserver === 'undefined') return undefined;
    lensCount += 1;
    const id = `tvm-lens-${lensCount}`;
    const svgNs = 'http://www.w3.org/2000/svg';
    const filter = document.createElementNS(svgNs, 'filter');
    filter.id = id;
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');
    svgHost().appendChild(filter);

    let lastKey = '';
    const rebuild = () => {
      const box = element.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) return;
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      const key = `${Math.round(box.width)}x${Math.round(box.height)}r${Math.round(radius)}`;
      if (key === lastKey) return;
      lastKey = key;
      const map = buildLensMap(box.width, box.height, radius);
      const url = mapDataUrl(map);
      if (url === null) return;
      filter.innerHTML =
        `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" edgeMode="duplicate" result="diffused"/>` +
        `<feImage href="${url}" x="0" y="0" width="${map.width}" height="${map.height}" preserveAspectRatio="none" result="lens"/>` +
        `<feDisplacementMap in="diffused" in2="lens" scale="${map.scale}" xChannelSelector="R" yChannelSelector="G" result="bent"/>` +
        `<feColorMatrix in="bent" type="saturate" values="${saturate}"/>`;
      element.style.setProperty('backdrop-filter', `url(#${id})`);
      element.style.setProperty('-webkit-backdrop-filter', `url(#${id})`);
      element.dataset.lens = 'on';
    };

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(rebuild);
    });
    observer.observe(element);
    rebuild();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      filter.remove();
      element.style.removeProperty('backdrop-filter');
      element.style.removeProperty('-webkit-backdrop-filter');
      delete element.dataset.lens;
    };
  }, [ref, blur, saturate]);
}
