/** Shared cinematic stage: WebGL field + helpers. CSS in scene.css is the fallback. */

export type SceneRunMode = 'off' | 'still' | 'live';

export interface ScenePalette {
  sky: readonly [number, number, number];
  skyMid: readonly [number, number, number];
  horizon: readonly [number, number, number];
  sea: readonly [number, number, number];
  deep: readonly [number, number, number];
  foam: readonly [number, number, number];
  sun: readonly [number, number, number];
  land: readonly [number, number, number];
  grain: number;
  opacity: number;
  mood: number;
}

export interface SceneGpu {
  destroy: () => void;
}

export const SCENE_STILL_TIME = 18.4;
export const SCENE_MAX_BUFFER = 1280;
export const SCENE_SCALE = 0.52;

export const SCENE_VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const SCENE_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uTime;
uniform float uMood;
uniform float uGrain;
uniform vec3 uSky;
uniform vec3 uSkyMid;
uniform vec3 uHorizon;
uniform vec3 uSea;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSun;
uniform vec3 uLand;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  v += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5;
  v += a * noise(p); p = p * 2.03 + vec2(8.3, 2.8); a *= 0.5;
  v += a * noise(p); p = p * 2.01 + vec2(3.1, 5.7); a *= 0.5;
  v += a * noise(p);
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(uRes, vec2(1.0));
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  float t1 = uTime * 0.017;
  float t2 = uTime * 0.011;
  float t3 = uTime * 0.023;
  float t4 = uTime * 0.0073;

  vec2 warp = 0.3 * vec2(
    sin(p.y * 1.85 + t1) + noise(p * 1.32 + vec2(t2, -t4)),
    cos(p.x * 1.52 - t3) + noise(p.yx * 1.18 + vec2(-t1, t2))
  );
  vec2 pw = p + warp;
  float n = fbm(pw * 1.12 + vec2(t4, t2));
  float nFine = fbm(pw * 2.35 - vec2(t3, t1));

  float isLight = step(0.5, uMood) * (1.0 - step(1.5, uMood));
  float isDark = step(1.5, uMood) * (1.0 - step(2.5, uMood));
  float isHappy = step(2.5, uMood) * (1.0 - step(3.5, uMood));
  float isSunset = step(3.5, uMood) * (1.0 - step(4.5, uMood));
  float isHeather = step(4.5, uMood) * (1.0 - step(5.5, uMood));
  float isGlass = step(5.5, uMood);

  float h = uv.y + (n - 0.5) * 0.06;
  vec3 col = mix(uSky, uSkyMid, smoothstep(-0.04, 0.36, h));
  col = mix(col, uHorizon, smoothstep(0.16, 0.5, h + nFine * 0.05));
  col = mix(col, uSea, smoothstep(0.4, 0.7, h));
  col = mix(col, uDeep, smoothstep(0.62, 1.04, h));

  float mist = smoothstep(0.26, 0.84, n) * (0.2 + 0.2 * nFine);
  col = mix(col, mix(uLand, uHorizon, nFine), mist * (0.42 + 0.12 * isHeather));
  col = mix(col, uFoam, mist * 0.1 * nFine);

  float bandY = 0.36 + 0.07 * sin(t2 + isSunset * 0.6) - 0.04 * isDark;
  float band = exp(-pow((uv.y - bandY) * (3.1 - isSunset), 2.0));
  float veil = band * smoothstep(0.32, 0.92, nFine);
  vec3 veilCol = mix(uHorizon, uSun, n);
  veilCol = mix(veilCol, uLand, isHeather * 0.35);
  col += veilCol * veil * (0.13 + 0.1 * isHappy + 0.12 * isSunset);

  float cau = sin(pw.x * 7.4 + n * 4.2 + t1 * 5.5) * sin(pw.y * 5.6 - nFine * 3.1 - t3 * 4.8);
  cau = pow(abs(cau) * 0.5 + 0.5, 4.6);
  float cauAmt = 0.045 + 0.07 * (1.0 - isDark) * (1.0 - isHappy) + 0.08 * isGlass + 0.03 * isLight;
  col += mix(uFoam, uSun, 0.35) * cau * cauAmt * smoothstep(0.28, 0.95, uv.y); // caustic ripples

  vec2 sunPos = vec2(
    mix(-0.02, 0.22, 1.0 - isHeather) * aspect + isSunset * 0.06 * aspect,
    mix(-0.34, -0.22, isLight) - isSunset * 0.04 + isDark * 0.18
  );
  vec2 sd = p - sunPos;
  float sunCore = exp(-dot(sd, sd) * mix(16.0, 9.0, isSunset));
  float sunBloom = exp(-dot(sd, sd) * mix(3.4, 1.8, isSunset + isHappy));
  float sunAmt = 0.28 + 0.34 * isSunset + 0.18 * isHappy + 0.12 * isLight - 0.18 * isDark;
  col += uSun * (sunCore * sunAmt + sunBloom * sunAmt * 0.42);

  vec2 k1 = p - vec2(sin(t3) * 0.48, cos(t1) * 0.2 - 0.04);
  vec2 k2 = p - vec2(cos(t4 * 1.6) * 0.58, sin(t2) * 0.28 - 0.08);
  vec2 a1 = k1 * vec2(3.2, 11.5);
  vec2 a2 = k2 * vec2(10.5, 3.8);
  float spec = exp(-dot(a1, a1)) + exp(-dot(a2, a2));
  col += mix(uFoam, uSun, 0.4) * spec * (0.11 + 0.08 * isGlass);

  float star = step(0.987, hash(floor(gl_FragCoord.xy * 0.42) + vec2(17.0, 9.0)));
  col += uFoam * star * isDark * 0.45;

  col = mix(col, col * vec3(1.06, 1.0, 0.96), isHappy * 0.2);
  col = mix(col, col * vec3(1.08, 0.98, 0.9), isSunset * 0.22);
  col = mix(col, col * vec3(0.96, 0.98, 1.06), (isGlass + isDark) * 0.12);
  col = mix(col, col * vec3(0.98, 0.94, 1.06), isHeather * 0.16);
  col = mix(col, mix(col, vec3(1.0), 0.08), isLight);

  vec3 split = vec3(
    fbm(pw * 1.12 + vec2(0.04, 0.0)),
    n,
    fbm(pw * 1.12 - vec2(0.04, 0.0))
  );
  col = mix(col, col * (0.92 + 0.12 * split), 0.07);

  float g = hash(gl_FragCoord.xy + vec2(fract(uTime * 0.11) * 47.0, fract(uTime * 0.07) * 23.0));
  col += (g - 0.5) * uGrain;

  float vig = 1.0 - 0.22 * pow(length((uv - 0.5) * vec2(1.05, 1.0)), 1.6);
  col *= mix(0.9, 1.0, vig);
  col = mix(col, col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0)), 0.1);
  col = clamp(col, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function sceneMoodId(theme: string): number {
  switch (theme) {
    case 'light':
      return 1;
    case 'dark':
      return 2;
    case 'happy':
      return 3;
    case 'sunset':
      return 4;
    case 'heather':
      return 5;
    case 'glass':
      return 6;
    default:
      return 0;
  }
}

export function sceneShouldRun(input: {
  hidden: boolean;
  reducedMotion: boolean;
  player: boolean;
  synthwave: boolean;
}): SceneRunMode {
  if (input.synthwave || input.player || input.hidden) return 'off';
  if (input.reducedMotion) return 'still';
  return 'live';
}

export function sceneBufferSize(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
  const scale = Math.min(Math.max(dpr, 0.75), 1.25) * SCENE_SCALE;
  let w = Math.max(2, Math.round(Math.max(cssW, 1) * scale));
  let h = Math.max(2, Math.round(Math.max(cssH, 1) * scale));
  const long = Math.max(w, h);
  if (long > SCENE_MAX_BUFFER) {
    const k = SCENE_MAX_BUFFER / long;
    w = Math.max(2, Math.round(w * k));
    h = Math.max(2, Math.round(h * k));
  }
  return { w, h };
}

export function parseCssRgb(value: string): [number, number, number] {
  const raw = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(raw);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const expanded = digits.length === 3 || digits.length === 4 ? [...digits].map((c) => `${c}${c}`).join('') : digits;
    const n = Number.parseInt(expanded.slice(0, 6), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const fn = /rgba?\(([^)]+)\)/i.exec(raw);
  if (fn !== null) {
    const body = fn[1] ?? '';
    const parts = body
      .split(/[\s,/]+/)
      .filter((part) => part !== '');
    const nums = parts.slice(0, 3).map((part) => {
      if (part.endsWith('%')) return Number(part.slice(0, -1)) / 100;
      return Number(part);
    });
    if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
      const scale = Math.max(nums[0]!, nums[1]!, nums[2]!) > 1 ? 255 : 1;
      return [nums[0]! / scale, nums[1]! / scale, nums[2]! / scale];
    }
  }
  return [0.05, 0.08, 0.12];
}

export function readScenePalette(style: CSSStyleDeclaration, theme: string): ScenePalette {
  const color = (key: string, fallback: string): [number, number, number] =>
    parseCssRgb(style.getPropertyValue(key).trim() || fallback);
  const num = (key: string, fallback: number): number => {
    const value = Number.parseFloat(style.getPropertyValue(key).trim());
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    sky: color('--tvm-scene-sky', '#7ec8e8'),
    skyMid: color('--tvm-scene-sky-mid', '#9ee0d4'),
    horizon: color('--tvm-scene-horizon', '#c8fff0'),
    sea: color('--tvm-scene-sea', '#1a5a8a'),
    deep: color('--tvm-scene-sea-deep', '#0a2a4a'),
    foam: color('--tvm-scene-foam', '#e8fff8'),
    sun: color('--tvm-scene-sun', '#fff6c8'),
    land: color('--tvm-scene-land', '#3d8a68'),
    grain: Math.min(0.12, Math.max(0, num('--tvm-scene-grain', 0.045))),
    opacity: Math.min(1, Math.max(0, num('--tvm-scene-opacity', 0.42))),
    mood: sceneMoodId(theme),
  };
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function currentMode(): SceneRunMode {
  const theme = document.documentElement.dataset.theme ?? 'default';
  return sceneShouldRun({
    hidden: document.visibilityState === 'hidden',
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    player: document.querySelector('[data-screen="player"]') !== null,
    synthwave: theme === 'synthwave',
  });
}

export function attachSceneGpu(canvas: HTMLCanvasElement): SceneGpu | null {
  try {
    return startSceneGpu(canvas);
  } catch {
    return null;
  }
}

function startSceneGpu(canvas: HTMLCanvasElement): SceneGpu | null {
  const opts: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  };
  const gl = (canvas.getContext('webgl', opts) ??
    canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
  if (gl === null) return null;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const vs = compile(gl, gl.VERTEX_SHADER, SCENE_VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, SCENE_FRAG);
  if (vs === null || fs === null) return null;
  const program = gl.createProgram();
  if (program === null) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  const uRes = gl.getUniformLocation(program, 'uRes');
  const uTime = gl.getUniformLocation(program, 'uTime');
  const uMood = gl.getUniformLocation(program, 'uMood');
  const uGrain = gl.getUniformLocation(program, 'uGrain');
  const uSky = gl.getUniformLocation(program, 'uSky');
  const uSkyMid = gl.getUniformLocation(program, 'uSkyMid');
  const uHorizon = gl.getUniformLocation(program, 'uHorizon');
  const uSea = gl.getUniformLocation(program, 'uSea');
  const uDeep = gl.getUniformLocation(program, 'uDeep');
  const uFoam = gl.getUniformLocation(program, 'uFoam');
  const uSun = gl.getUniformLocation(program, 'uSun');
  const uLand = gl.getUniformLocation(program, 'uLand');

  let dead = false;
  let raf = 0;
  let looping = false;
  let palette = readScenePalette(getComputedStyle(document.documentElement), document.documentElement.dataset.theme ?? 'default');
  let lastPaletteAt = 0;
  const born = performance.now();

  const resize = (): void => {
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    const next = sceneBufferSize(cssW, cssH, window.devicePixelRatio || 1);
    if (canvas.width !== next.w || canvas.height !== next.h) {
      canvas.width = next.w;
      canvas.height = next.h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const syncPalette = (force = false): void => {
    const now = performance.now();
    if (!force && now - lastPaletteAt < 400) return;
    lastPaletteAt = now;
    palette = readScenePalette(
      getComputedStyle(document.documentElement),
      document.documentElement.dataset.theme ?? 'default',
    );
  };

  const paint = (time: number): void => {
    if (dead) return;
    resize();
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, time);
    gl.uniform1f(uMood, palette.mood);
    gl.uniform1f(uGrain, palette.grain);
    gl.uniform3f(uSky, palette.sky[0], palette.sky[1], palette.sky[2]);
    gl.uniform3f(uSkyMid, palette.skyMid[0], palette.skyMid[1], palette.skyMid[2]);
    gl.uniform3f(uHorizon, palette.horizon[0], palette.horizon[1], palette.horizon[2]);
    gl.uniform3f(uSea, palette.sea[0], palette.sea[1], palette.sea[2]);
    gl.uniform3f(uDeep, palette.deep[0], palette.deep[1], palette.deep[2]);
    gl.uniform3f(uFoam, palette.foam[0], palette.foam[1], palette.foam[2]);
    gl.uniform3f(uSun, palette.sun[0], palette.sun[1], palette.sun[2]);
    gl.uniform3f(uLand, palette.land[0], palette.land[1], palette.land[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const stopLoop = (): void => {
    looping = false;
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const tick = (): void => {
    if (dead || !looping) return;
    const mode = currentMode();
    if (mode !== 'live') {
      stopLoop();
      sync();
      return;
    }
    syncPalette();
    paint((performance.now() - born) / 1000);
    raf = requestAnimationFrame(tick);
  };

  const sync = (): void => {
    if (dead) return;
    const mode = currentMode();
    canvas.parentElement?.setAttribute('data-run', mode);
    if (mode === 'off') {
      stopLoop();
      return;
    }
    syncPalette(true);
    if (mode === 'still') {
      stopLoop();
      paint(SCENE_STILL_TIME);
      return;
    }
    paint((performance.now() - born) / 1000);
    if (!looping) {
      looping = true;
      raf = requestAnimationFrame(tick);
    }
  };

  const onLost = (event: Event): void => {
    event.preventDefault();
    stopLoop();
    canvas.parentElement?.setAttribute('data-engine', 'css');
  };
  const onRestored = (): void => {
    canvas.parentElement?.setAttribute('data-engine', 'webgl');
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    sync();
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const screenHost = document.querySelector('.app__screen');
  if (screenHost !== null) {
    observer.observe(screenHost, { childList: true });
  }
  const ro = new ResizeObserver(sync);
  ro.observe(canvas);
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', sync);
  reduce.addEventListener('change', sync);

  sync();

  return {
    destroy: () => {
      if (dead) return;
      dead = true;
      stopLoop();
      observer.disconnect();
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', sync);
      reduce.removeEventListener('change', sync);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    },
  };
}
