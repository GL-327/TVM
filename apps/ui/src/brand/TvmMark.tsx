import { useId } from 'react';
import './TvmMark.css';

export type TvmMarkSize = 'sm' | 'md' | 'lg';

interface TvmMarkProps {
  size?: TvmMarkSize;
  className?: string;
  animated?: boolean;
  /** Keep the bloom and scanline moving (loading screens). */
  loop?: boolean;
}

/** Custom TVM mark: a screen bezel with a play crystal. Not a licensed streamer logo. */
export function TvmMark({ size = 'md', className, animated = false, loop = false }: TvmMarkProps): React.JSX.Element {
  const raw = useId().replace(/:/g, '');
  const glow = `tvm-mark-glow-${raw}`;
  const wash = `tvm-mark-wash-${raw}`;
  const screen = `tvm-mark-screen-${raw}`;
  const gem = `tvm-mark-gem-${raw}`;
  const classes = [
    'tvm-mark',
    `tvm-mark--${size}`,
    animated ? 'tvm-mark--animated' : '',
    loop ? 'tvm-mark--loop' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <svg className={classes} viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        <linearGradient id={wash} x1="8" y1="4" x2="76" y2="76">
          <stop stopColor="#7ad7ff" />
          <stop offset="0.38" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#ff7a4a" />
        </linearGradient>
        <linearGradient id={screen} x1="20" y1="16" x2="60" y2="58">
          <stop stopColor="#2a1a28" />
          <stop offset="1" stopColor="#12080e" />
        </linearGradient>
        <linearGradient id={gem} x1="28" y1="22" x2="54" y2="50">
          <stop stopColor="#fff6e4" />
          <stop offset="0.45" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#ff7a4a" />
        </linearGradient>
        <radialGradient id={glow} cx="50%" cy="42%" r="58%">
          <stop stopColor="#fff6e4" stopOpacity="0.95" />
          <stop offset="0.42" stopColor="#ffd27a" stopOpacity="0.4" />
          <stop offset="1" stopColor="#ff7a4a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="tvm-mark__bloom" cx="40" cy="40" r="34" fill={`url(#${glow})`} />
      <rect
        className="tvm-mark__bezel"
        x="12"
        y="14"
        width="56"
        height="48"
        rx="13"
        fill="none"
        stroke={`url(#${wash})`}
        strokeWidth="3"
      />
      <rect className="tvm-mark__glass" x="18" y="20" width="44" height="36" rx="8" fill={`url(#${screen})`} />
      <path className="tvm-mark__play" d="M33 26.5v23L54 38z" fill={`url(#${gem})`} />
      <path className="tvm-mark__play-edge" d="M33 26.5v23L54 38z" fill="none" stroke="#fff6e4" strokeOpacity="0.45" strokeWidth="1.1" />
      <path className="tvm-mark__scan" d="M22 32h36" stroke="#fff6e4" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
