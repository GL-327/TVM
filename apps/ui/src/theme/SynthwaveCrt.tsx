import { useId, type CSSProperties } from 'react';

/** Berlin-style radio rings: warm phosphor bands, all curves. */
const RINGS = [
  { r: 18, color: '#c45cff' },
  { r: 26, color: '#ff3d8a' },
  { r: 34, color: '#ff2a2a' },
  { r: 42, color: '#ff6a18' },
  { r: 50, color: '#ffb020' },
  { r: 58, color: '#ffe56a' },
] as const;

const PULSES = [0, 1] as const;

const BOWS = [
  { i: 0, color: '#7a1f28' },
  { i: 1, color: '#c43a2a' },
  { i: 2, color: '#d96a1a' },
  { i: 3, color: '#e2b03a' },
  { i: 4, color: '#efe0b0' },
] as const;

const MOTES = [
  { x: '14%', y: '16%', d: '0s', s: '0.2rem' },
  { x: '86%', y: '22%', d: '2.1s', s: '0.16rem' },
  { x: '18%', y: '78%', d: '3.6s', s: '0.18rem' },
  { x: '78%', y: '82%', d: '1.1s', s: '0.16rem' },
] as const;

/** Closed cubic loop — same commands at every keyframe so the landmark can melt. */
export const MARK_SUN =
  'M 100.00 52.00 C 109.02 52.00 117.67 55.58 124.04 61.96 C 130.42 68.33 134.00 76.98 134.00 86.00 C 134.00 95.02 130.42 103.67 124.04 110.04 C 117.67 116.42 109.02 120.00 100.00 120.00 C 90.98 120.00 82.33 116.42 75.96 110.04 C 69.58 103.67 66.00 95.02 66.00 86.00 C 66.00 76.98 69.58 68.33 75.96 61.96 C 82.33 55.58 90.98 52.00 100.00 52.00 Z';
export const MARK_DOME =
  'M 100.00 64.00 C 112.20 64.00 123.90 66.95 132.53 72.20 C 141.15 77.45 146.00 84.57 146.00 92.00 C 146.00 99.43 141.15 106.55 132.53 111.80 C 123.90 117.05 112.20 120.00 100.00 120.00 C 87.80 120.00 76.10 117.05 67.47 111.80 C 58.85 106.55 54.00 99.43 54.00 92.00 C 54.00 84.57 58.85 77.45 67.47 72.20 C 76.10 66.95 87.80 64.00 100.00 64.00 Z';
export const MARK_WIDE =
  'M 100.00 80.00 C 113.79 80.00 127.02 81.69 136.77 84.69 C 146.52 87.69 152.00 91.76 152.00 96.00 C 152.00 100.24 146.52 104.31 136.77 107.31 C 127.02 110.31 113.79 112.00 100.00 112.00 C 86.21 112.00 72.98 110.31 63.23 107.31 C 53.48 104.31 48.00 100.24 48.00 96.00 C 48.00 91.76 53.48 87.69 63.23 84.69 C 72.98 81.69 86.21 80.00 100.00 80.00 Z';
export const MARK_TALL =
  'M 100.00 30.00 C 104.24 30.00 108.31 35.06 111.31 44.06 C 114.31 53.06 116.00 65.27 116.00 78.00 C 116.00 90.73 114.31 102.94 111.31 111.94 C 108.31 120.94 104.24 126.00 100.00 126.00 C 95.76 126.00 91.69 120.94 88.69 111.94 C 85.69 102.94 84.00 90.73 84.00 78.00 C 84.00 65.27 85.69 53.06 88.69 44.06 C 91.69 35.06 95.76 30.00 100.00 30.00 Z';
export const MARK_LENS =
  'M 100.00 74.00 C 118.40 74.00 136.20 77.40 147.80 82.20 C 159.40 87.00 164.00 91.40 164.00 86.00 C 164.00 80.60 159.40 85.00 147.80 89.80 C 136.20 94.60 118.40 98.00 100.00 98.00 C 81.60 98.00 63.80 94.60 52.20 89.80 C 40.60 85.00 36.00 80.60 36.00 86.00 C 36.00 91.40 40.60 87.00 52.20 82.20 C 63.80 77.40 81.60 74.00 100.00 74.00 Z';
export const MARK_PETAL =
  'M 100.00 38.00 C 106.80 38.00 113.40 46.40 118.00 58.80 C 122.60 71.20 125.00 85.60 125.00 96.00 C 125.00 106.40 122.60 116.80 118.00 123.20 C 113.40 129.60 106.80 132.00 100.00 132.00 C 93.20 132.00 86.60 129.60 82.00 123.20 C 77.40 116.80 75.00 106.40 75.00 96.00 C 75.00 85.60 77.40 71.20 82.00 58.80 C 86.60 46.40 93.20 38.00 100.00 38.00 Z';
export const MARK_CRESCENT =
  'M 94.00 50.00 C 96.00 48.33 115.67 50.00 124.00 56.00 C 132.33 62.00 144.00 76.00 144.00 86.00 C 144.00 96.00 132.33 110.00 124.00 116.00 C 115.67 122.00 96.00 123.67 94.00 122.00 C 92.00 120.33 108.00 112.00 112.00 106.00 C 116.00 100.00 118.00 92.67 118.00 86.00 C 118.00 79.33 116.00 72.00 112.00 66.00 C 108.00 60.00 92.00 51.67 94.00 50.00 Z';
export const MARK_EYE =
  'M 100.00 70.00 C 110.67 70.00 120.67 71.33 132.00 74.00 C 143.33 76.67 168.00 82.00 168.00 86.00 C 168.00 90.00 143.33 95.33 132.00 98.00 C 120.67 100.67 110.67 102.00 100.00 102.00 C 89.33 102.00 79.33 100.67 68.00 98.00 C 56.67 95.33 32.00 90.00 32.00 86.00 C 32.00 82.00 56.67 76.67 68.00 74.00 C 79.33 71.33 89.33 70.00 100.00 70.00 Z';
export const MARK_STADIUM =
  'M 100.00 70.00 C 114.00 70.00 132.33 67.33 142.00 70.00 C 151.67 72.67 158.00 80.67 158.00 86.00 C 158.00 91.33 151.67 99.33 142.00 102.00 C 132.33 104.67 114.00 102.00 100.00 102.00 C 86.00 102.00 67.67 104.67 58.00 102.00 C 48.33 99.33 42.00 91.33 42.00 86.00 C 42.00 80.67 48.33 72.67 58.00 70.00 C 67.67 67.33 86.00 70.00 100.00 70.00 Z';
export const MARK_TEAR =
  'M 100.00 36.00 C 104.00 36.00 107.33 49.00 112.00 58.00 C 116.67 67.00 127.00 80.67 128.00 90.00 C 129.00 99.33 122.67 108.00 118.00 114.00 C 113.33 120.00 106.00 126.00 100.00 126.00 C 94.00 126.00 86.67 120.00 82.00 114.00 C 77.33 108.00 71.00 99.33 72.00 90.00 C 73.00 80.67 83.33 67.00 88.00 58.00 C 92.67 49.00 96.00 36.00 100.00 36.00 Z';
export const MARK_PEANUT =
  'M 100.00 34.00 C 107.33 34.00 120.00 39.33 122.00 48.00 C 124.00 56.67 112.00 73.33 112.00 86.00 C 112.00 98.67 124.00 115.33 122.00 124.00 C 120.00 132.67 107.33 138.00 100.00 138.00 C 92.67 138.00 80.00 132.67 78.00 124.00 C 76.00 115.33 88.00 98.67 88.00 86.00 C 88.00 73.33 76.00 56.67 78.00 48.00 C 80.00 39.33 92.67 34.00 100.00 34.00 Z';
export const MARK_ARCH =
  'M 100.00 40.00 C 116.67 40.00 138.67 39.00 150.00 52.00 C 161.33 65.00 169.67 108.00 168.00 118.00 C 166.33 128.00 151.33 120.67 140.00 112.00 C 128.67 103.33 113.33 66.00 100.00 66.00 C 86.67 66.00 71.33 103.33 60.00 112.00 C 48.67 120.67 33.67 128.00 32.00 118.00 C 30.33 108.00 38.67 65.00 50.00 52.00 C 61.33 39.00 83.33 40.00 100.00 40.00 Z';

export const SINE_FLAT =
  'M 8.00 168.00 C 15.67 168.00 23.33 168.00 31.00 168.00 C 38.67 168.00 46.33 168.00 54.00 168.00 C 61.67 168.00 69.33 168.00 77.00 168.00 C 84.67 168.00 92.33 168.00 100.00 168.00 C 107.67 168.00 115.33 168.00 123.00 168.00 C 130.67 168.00 138.33 168.00 146.00 168.00 C 153.67 168.00 161.33 168.00 169.00 168.00 C 176.67 168.00 184.33 168.00 192.00 168.00';
export const SINE_A =
  'M 8.00 168.00 C 15.67 176.92 23.33 183.49 31.00 186.00 C 38.67 183.64 46.33 177.16 54.00 168.00 C 61.67 159.08 69.33 152.51 77.00 150.00 C 84.67 152.36 92.33 158.84 100.00 168.00 C 107.67 176.92 115.33 183.49 123.00 186.00 C 130.67 183.64 138.33 177.16 146.00 168.00 C 153.67 159.08 161.33 152.51 169.00 150.00 C 176.67 152.36 184.33 158.84 192.00 168.00';
export const SINE_B =
  'M 8.00 184.78 C 15.67 185.80 23.33 182.15 31.00 174.52 C 38.67 165.35 46.33 156.88 54.00 151.22 C 61.67 150.20 69.33 153.85 77.00 161.48 C 84.67 170.65 92.33 179.12 100.00 184.78 C 107.67 185.80 115.33 182.15 123.00 174.52 C 130.67 165.35 138.33 156.88 146.00 151.22 C 153.67 150.20 161.33 153.85 169.00 161.48 C 176.67 170.65 184.33 179.12 192.00 184.78';
export const SINE_C =
  'M 8.00 168.00 C 15.67 159.08 23.33 152.51 31.00 150.00 C 38.67 152.36 46.33 158.84 54.00 168.00 C 61.67 176.92 69.33 183.49 77.00 186.00 C 84.67 183.64 92.33 177.16 100.00 168.00 C 107.67 159.08 115.33 152.51 123.00 150.00 C 130.67 152.36 138.33 158.84 146.00 168.00 C 153.67 176.92 161.33 183.49 169.00 186.00 C 176.67 183.64 184.33 177.16 192.00 168.00';

function Name(): React.JSX.Element {
  return (
    <p className="sw-id__name">
      {[...'TVM'].map((letter, index) => (
        <span key={`${letter}-${index}`} style={{ animationDelay: `${0.55 + index * 0.12}s` }}>
          {letter}
        </span>
      ))}
    </p>
  );
}

function Tag(): React.JSX.Element {
  return (
    <p className="sw-id__tag">
      {[...'COLOUR'].map((letter, index) => (
        <span key={`${letter}-${index}`} style={{ animationDelay: `${1.15 + index * 0.06}s` }}>
          {letter}
        </span>
      ))}
    </p>
  );
}

/** One analog 1970s/80s station ident: rings, rainbow, oscilloscope, morphing landmark. */
export function SynthwaveCrt(): React.JSX.Element {
  const raw = useId().replace(/:/g, '');
  const phos = `sw-phos-${raw}`;
  const bloom = `sw-bloom-${raw}`;

  return (
    <div className="sw-crt" aria-hidden="true">
      <div className="sw-crt__haze" />
      <div className="sw-crt__motes">
        {MOTES.map((mote) => (
          <span
            key={`${mote.x}-${mote.y}`}
            className="sw-crt__mote"
            style={
              {
                left: mote.x,
                top: mote.y,
                width: mote.s,
                height: mote.s,
                animationDelay: mote.d,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="sw-crt__burst" />
      <div className="sw-crt__rainbow" />
      <div className="sw-crt__rainbow sw-crt__rainbow--foot" />
      <div className="sw-crt__stage">
        <span className="sw-id__beam" />
        <span className="sw-id__lock" />
        <svg className="sw-ident" viewBox="0 0 200 200">
          <defs>
            <pattern id={phos} width="3" height="6" patternUnits="userSpaceOnUse">
              <rect width="3" height="4" fill="#fff3c4" />
              <rect y="4" width="3" height="2" fill="#000" />
            </pattern>
            <filter id={bloom} x="-18%" y="-18%" width="136%" height="136%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g className="sw-ident__field">
            {RINGS.map((ring) => (
              <circle
                key={ring.color}
                className="sw-ident__ring sw-phos-stroke"
                cx="100"
                cy="86"
                r={ring.r}
                fill="none"
                stroke={ring.color}
                style={{ '--ink': ring.color, '--ring-s': String(ring.r / 18) } as CSSProperties}
              />
            ))}
            {PULSES.map((pulse) => (
              <circle
                key={`pulse-${pulse}`}
                className="sw-ident__pulse"
                cx="100"
                cy="86"
                r="16"
                fill="none"
                style={{ animationDelay: `${pulse * 2.8}s` }}
              />
            ))}
            {BOWS.map((bow) => (
              <path
                key={bow.color}
                className="sw-ident__bow"
                d="M 42 108 C 42 72 68 48 100 48 C 132 48 158 72 158 108"
                fill="none"
                stroke={bow.color}
                style={{ '--ink': bow.color, '--i': bow.i } as CSSProperties}
              />
            ))}
            <path className="sw-ident__mark" d={MARK_SUN} fill="none" />
            <circle className="sw-ident__orb sw-morph__core" cx="100" cy="86" r="11" fill={`url(#${phos})`} filter={`url(#${bloom})`} />
            <rect className="sw-ident__mast sw-id__shaft" x="97.4" y="86" width="5.2" height="62" rx="2.6" fill={`url(#${phos})`} />
            <path className="sw-ident__spire sw-id__peak" d="M 100 18 C 103.4 28 104.2 36 100 42 C 95.8 36 96.6 28 100 18 Z" fill={`url(#${phos})`} />
            <line className="sw-id__hand sw-id__hand--h" x1="100" y1="86" x2="100" y2="74" />
            <line className="sw-id__hand sw-id__hand--m" x1="100" y1="86" x2="108" y2="80" />
            <path className="sw-ident__sine sw-id__wave" d={SINE_A} fill="none" />
          </g>
        </svg>
        <Name />
        <Tag />
      </div>
      <div className="sw-crt__tube" />
      <div className="sw-crt__scan" />
      <div className="sw-crt__raster" />
      <div className="sw-crt__flicker" />
    </div>
  );
}
