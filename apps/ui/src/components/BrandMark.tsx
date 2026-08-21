import './BrandMark.css';

const KNOWN = [
  'tvm-stream',
  'netflix',
  'prime',
  'max',
  'appletv',
  'disney',
  'hulu',
  'peacock',
  'youtube',
  'iplayer',
  'paramount',
  'tubi',
  'pluto',
  'starz',
  'fox',
  'freevee',
] as const;

export type BrandId = (typeof KNOWN)[number];

export function hasBrandMark(id: string): id is BrandId {
  return (KNOWN as readonly string[]).includes(id);
}

const SW = 6.6;

type Glyph = {
  paths: string[];
  w: number;
  dots?: Array<[number, number, number]>;
};

function n(x: number, paths: string[], extra = 0, dots?: Glyph['dots']): Glyph {
  return { paths, w: x + extra, dots };
}

function lcI(x: number): Glyph {
  return n(x, [`M${x + 3.3} 13.2v26.8`], 9.2, [[x + 3.3, 6.35, 3.15]]);
}

function lcL(x: number): Glyph {
  return n(x, [`M${x + 3.3} 5v35`], 9.4);
}

function lcR(x: number): Glyph {
  return n(x, [`M${x + 3.3} 13.2v26.8`, `M${x + 3.3} 15.2c7.4-1.2 12.2 2.2 12.2 8.4`], 16.4);
}

function lcN(x: number): Glyph {
  return n(
    x,
    [`M${x + 3.3} 40V13.2`, `M${x + 3.3} 19.5c.6-7.2 14.8-8.2 16.2 2.2V40`],
    23.2,
  );
}

function lcM(x: number): Glyph {
  return n(
    x,
    [
      `M${x + 3.3} 40V13.2`,
      `M${x + 3.3} 19.5c.6-7.2 14.6-8.2 16 2.2V40`,
      `M${x + 19.3} 19.5c.6-7.2 14.6-8.2 16 2.2V40`,
    ],
    38.8,
  );
}

function lcU(x: number): Glyph {
  return n(x, [`M${x + 3.3} 13.2v14.2c0 9.6 5.4 14.4 12.6 14.4s12.6-4.8 12.6-14.4V13.2`], 28.8);
}

function lcV(x: number): Glyph {
  return n(x, [`M${x + 1.6} 13.2L${x + 11.4} 40L${x + 21.2} 13.2`], 23);
}

function lcO(x: number): Glyph {
  return n(x, [`M${x + 24} 26a10.7 10.7 0 1 1-21.4 0a10.7 10.7 0 1 1 21.4 0`], 26.6);
}

function lcC(x: number): Glyph {
  return n(x, [`M${x + 21.6} 16.4a10.7 10.7 0 1 0 .4 19.2`], 24.8);
}

function lcE(x: number): Glyph {
  return n(x, [`M${x + 21.4} 16.6a10.7 10.7 0 1 0 .2 18.8`, `M${x + 6.2} 26h15.4`], 25.2);
}

function lcP(x: number): Glyph {
  return n(x, [`M${x + 3.3} 13.2v41.2`, `M${x + 24} 26a10.7 10.7 0 1 1-21.4 0a10.7 10.7 0 1 1 21.4 0`], 26.6);
}

function lcD(x: number): Glyph {
  return n(x, [`M${x + 23.3} 5v35`, `M${x + 24} 26a10.7 10.7 0 1 1-21.4 0a10.7 10.7 0 1 1 21.4 0`], 26.6);
}

function lcB(x: number): Glyph {
  return n(x, [`M${x + 3.3} 5v35`, `M${x + 24} 26a10.7 10.7 0 1 1-21.4 0a10.7 10.7 0 1 1 21.4 0`], 26.6);
}

function lcA(x: number): Glyph {
  return n(x, [`M${x + 24} 26a10.7 10.7 0 1 1-21.4 0a10.7 10.7 0 1 1 21.4 0`, `M${x + 23.3} 13.2v26.8`], 26.6);
}

function lcK(x: number): Glyph {
  return n(x, [`M${x + 3.3} 5v35`, `M${x + 3.3} 24L${x + 18.5} 8`, `M${x + 8.4} 21.5L${x + 21.2} 40`], 23.4);
}

function lcY(x: number): Glyph {
  return n(x, [`M${x + 1.8} 13.2L${x + 11.2} 32`, `M${x + 20.4} 13.2L${x + 8.6} 52`], 22.2);
}

function lcS(x: number): Glyph {
  return n(
    x,
    [`M${x + 19.2} 16.2c-1.6-5.2-14.8-6.4-15.4.8c-.6 6.4 15.8 5.2 15.6 13.2c-.2 7.2-14.6 8-16.4 2.6`],
    21.4,
  );
}

function capY(x: number): Glyph {
  return n(x, [`M${x + 1.6} 5L${x + 13.2} 22.4V40`, `M${x + 24.8} 5L${x + 13.2} 22.4`], 26.4);
}

function capT(x: number): Glyph {
  return n(x, [`M${x + 1.2} 8.2h22.2`, `M${x + 12.3} 8.2V40`], 24.6);
}

function capP(x: number): Glyph {
  return n(x, [`M${x + 3.3} 5v35`, `M${x + 3.3} 5h9.4c8.8 0 12.6 8.2 12.6 13.6S${x + 21.5} 32.2 ${x + 12.7} 32.2H${x + 3.3}`], 24.6);
}

function capL(x: number): Glyph {
  return n(x, [`M${x + 3.3} 5v35h16.8`], 21.6);
}

function capA(x: number): Glyph {
  return n(x, [`M${x + 1.8} 40L${x + 14.2} 5L${x + 26.6} 40`, `M${x + 7.6} 27.6h13.2`], 28.4);
}

function capE(x: number): Glyph {
  return n(x, [`M${x + 3.3} 5v35`, `M${x + 3.3} 5h16.8`, `M${x + 3.3} 22.5h13.6`, `M${x + 3.3} 40h16.8`], 21.4);
}

function capR(x: number): Glyph {
  return n(
    x,
    [
      `M${x + 3.3} 5v35`,
      `M${x + 3.3} 5h9.2c8.6 0 12.4 8 12.4 13.4S${x + 21.1} 31.8 ${x + 12.5} 31.8H${x + 3.3}`,
      `M${x + 12.4} 31.8L${x + 23.6} 40`,
    ],
    25.2,
  );
}

const GLYPHS: Record<string, (x: number) => Glyph> = {
  i: lcI,
  l: lcL,
  r: lcR,
  n: lcN,
  m: lcM,
  u: lcU,
  v: lcV,
  o: lcO,
  c: lcC,
  e: lcE,
  p: lcP,
  d: lcD,
  b: lcB,
  a: lcA,
  k: lcK,
  y: lcY,
  s: lcS,
  Y: capY,
  T: capT,
  P: capP,
  L: capL,
  A: capA,
  E: capE,
  R: capR,
};

function spell(text: string, tracking = 3.1): Glyph[] {
  const out: Glyph[] = [];
  let x = 0;
  for (const ch of text) {
    if (ch === ' ') {
      x += 9.2;
      continue;
    }
    const make = GLYPHS[ch];
    if (make === undefined) continue;
    const g = make(x);
    out.push(g);
    x = g.w + tracking - extraOverlap(ch);
  }
  return out;
}

function extraOverlap(ch: string): number {
  if (ch === 'i' || ch === 'l') return 1.2;
  return 0;
}

function Word({ text, tracking = 3.1, sw = SW }: { text: string; tracking?: number; sw?: number }): React.JSX.Element {
  const glyphs = spell(text, tracking);
  return (
    <g fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {glyphs.flatMap((g, i) =>
        g.paths.map((d, j) => <path key={`${i}-${j}`} d={d} />),
      )}
      {glyphs.flatMap((g, i) =>
        (g.dots ?? []).map(([cx, cy, r], j) => (
          <circle key={`d${i}-${j}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
        )),
      )}
    </g>
  );
}

function wordWidth(text: string, tracking = 3.1): number {
  const glyphs = spell(text, tracking);
  const last = glyphs[glyphs.length - 1];
  return last === undefined ? 0 : last.w;
}

function NetflixMark(): React.JSX.Element {
  return (
    <svg className="brand-mark__netflix" viewBox="0 0 100 168" aria-hidden="true">
      <path fill="currentColor" opacity="0.7" d="M0 0h31v168H0z" />
      <path fill="currentColor" opacity="0.7" d="M69 0h31v168H69z" />
      <path fill="currentColor" d="M0 0h31l69 168H69L0 0z" />
      <path fill="#000" opacity="0.2" d="M31 0h7.5L76 104h-8z" />
    </svg>
  );
}

function PrimeMark(): React.JSX.Element {
  const w = wordWidth('prime video');
  const endX = w + 2;
  return (
    <svg className="brand-mark__prime" viewBox={`0 0 ${w + 18} 74`} aria-hidden="true">
      <g transform="translate(4 0)">
        <Word text="prime video" />
      </g>
      <path
        fill="none"
        stroke="#00A8E1"
        strokeWidth="3.5"
        strokeLinecap="round"
        d={`M12 58C${w * 0.28} 74 ${w * 0.62} 76 ${endX} 49`}
      />
      <path fill="#00A8E1" d={`M${endX - 12} 41l16 7-14 8 5.5-8.2z`} />
    </svg>
  );
}

function MaxMark(): React.JSX.Element {
  return (
    <svg className="brand-mark__max" viewBox="0 0 236 78" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="10.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 66V33c0-18 16.5-26 29-11 5 5.5 8 13 8 22v22" />
        <path d="M59 66V33c0-18 16.5-26 29-11 5 5.5 8 13 8 22v22" />
        <circle cx="138" cy="40" r="21" />
        <path d="M172 16c12 16 22 32 30 50" />
        <path d="M202 16c-12 16-22 32-30 50" />
      </g>
    </svg>
  );
}

function AppleTvMark(): React.JSX.Element {
  return (
    <svg className="brand-mark__apple" viewBox="0 0 118 36" aria-hidden="true">
      <path
        fill="currentColor"
        d="M26.8 7.4c1.32-1.52 3.38-2.5 5.28-2.64-.14 2.2-1.22 4.16-2.78 5.48-1.48 1.28-3.48 2.16-5.4 2 .18-2.1 1.26-4 2.9-4.84z"
      />
      <path
        fill="currentColor"
        d="M32.2 11.2c-2.64-.14-4.74 1.38-6 1.38s-3.12-1.32-5.14-1.28c-2.64.06-5.1 1.52-6.42 3.92-2.74 4.8-.68 11.92 1.96 15.82 1.28 1.86 2.84 4.02 4.86 3.96 1.96-.04 2.7-1.28 5.06-1.28s3.04 1.28 5.12 1.22c2.1-.04 3.44-1.86 4.76-3.82 1.46-2.16 2.1-4.22 2.14-4.36-3.94-1.66-3.32-8.04.54-10.24.44-.24.84-.5 1.28-.68-1.42-2.1-3.72-3.34-7.16-3.34z"
      />
      <path fill="currentColor" d="M54.6 7.8h5.8v5.2h5.5v4.6h-5.5v9.6c0 2.15 1 3.1 3.05 3.1.7 0 1.35-.06 1.9-.16v4.45c-.72.14-1.65.24-2.78.24-4.95 0-7.07-2.15-7.07-6.95v-10.28h-3.25V13h3.25V7.8z" />
      <path fill="currentColor" d="M86.2 31.8h-5.7L67.9 7.8h5.85l5.45 16.35h.14L84.8 7.8h5.7z" />
    </svg>
  );
}

function DisneyMark(): React.JSX.Element {
  return (
    <svg className="brand-mark__disney" viewBox="0 0 408 160" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        d="M36 76C6 28 78 8 132 40c48 28 96 50 162 4 48-34 110-40 178 10"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M64 28h28c62 0 104 28 104 60s-42 60-104 60H64V28zm24 22v76c46 6 80-10 80-38s-34-44-80-38z"
      />
      <g transform="translate(196 46) skewX(-18) scale(1.16)">
        <Word text="isney" tracking={1.6} sw={8.2} />
      </g>
      <g fill="currentColor">
        <rect x="356" y="70" width="36" height="11" rx="2" />
        <rect x="368.5" y="57" width="11" height="36" rx="2" />
      </g>
    </svg>
  );
}

function HuluMark(): React.JSX.Element {
  return (
    <svg className="brand-mark__hulu" viewBox="0 0 248 72" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="13.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 6v58" />
        <path d="M16 38C16 22 56 22 56 42v20" />
        <path d="M80 26v16c0 16 8 22 22 22s22-6 22-22V26" />
        <path d="M152 6v58" />
        <path d="M172 26v16c0 16 8 22 22 22s22-6 22-22V26" />
      </g>
    </svg>
  );
}

function PeacockMark(): React.JSX.Element {
  const w = wordWidth('peacock', 3.6);
  const dotsX = w + 20;
  const colors = ['#FCCC12', '#FF7112', '#EF1541', '#6E55DC', '#069DE0', '#05AC3F'];
  return (
    <svg className="brand-mark__peacock" viewBox={`0 0 ${dotsX + 14} 56`} aria-hidden="true">
      <g transform="translate(2 4)">
        <Word text="peacock" tracking={3.6} />
      </g>
      {colors.map((fill, i) => (
        <circle key={fill} cx={dotsX} cy={6 + i * 8.6} r="3.5" fill={fill} />
      ))}
    </svg>
  );
}

function YouTubeMark(): React.JSX.Element {
  const w = wordWidth('YouTube', 2.9);
  return (
    <svg className="brand-mark__youtube" viewBox={`0 0 ${w + 52} 44`} aria-hidden="true">
      <rect x="0" y="8" width="36" height="26" rx="7.2" fill="#FF0000" />
      <path fill="#fff" d="M13.6 14.8v12.4L26.8 21 13.6 14.8z" />
      <g transform="translate(44 1)">
        <Word text="YouTube" tracking={2.9} />
      </g>
    </svg>
  );
}

function IplayerMark(): React.JSX.Element {
  const w = wordWidth('iPLAYER', 2.7);
  return (
    <svg className="brand-mark__iplayer" viewBox={`0 0 ${w + 92} 80`} aria-hidden="true">
      <g fill="#111">
        <rect x="0" y="12" width="44" height="15" rx="3.2" />
        <rect x="24" y="32.5" width="44" height="15" rx="3.2" />
        <rect x="0" y="53" width="44" height="15" rx="3.2" />
      </g>
      <g transform="translate(82 16)">
        <Word text="iPLAYER" tracking={2.7} sw={6.2} />
      </g>
    </svg>
  );
}

export function BrandMark({ id }: { id: string }): React.JSX.Element {
  const brand = hasBrandMark(id) ? id : 'tvm-stream';
  return (
    <span className={`brand-mark brand-mark--${brand}`} aria-hidden="true">
      {brand === 'netflix' && <NetflixMark />}
      {brand === 'prime' && <PrimeMark />}
      {brand === 'max' && <MaxMark />}
      {brand === 'appletv' && <AppleTvMark />}
      {brand === 'disney' && <DisneyMark />}
      {brand === 'hulu' && <HuluMark />}
      {brand === 'peacock' && <PeacockMark />}
      {brand === 'youtube' && <YouTubeMark />}
      {brand === 'iplayer' && <IplayerMark />}
      {brand === 'paramount' && (
        <span className="brand-mark__paramount">
          <span className="brand-mark__peak" />
          <span>paramount+</span>
        </span>
      )}
      {brand === 'tubi' && <span className="brand-mark__tubi">tubi</span>}
      {brand === 'pluto' && <span className="brand-mark__pluto">Pluto TV</span>}
      {brand === 'starz' && <span className="brand-mark__starz">STARZ</span>}
      {brand === 'fox' && <span className="brand-mark__fox">FOX</span>}
      {brand === 'freevee' && <span className="brand-mark__freevee">freevee</span>}
      {brand === 'tvm-stream' && <span className="brand-mark__tvm">TVM</span>}
    </span>
  );
}
