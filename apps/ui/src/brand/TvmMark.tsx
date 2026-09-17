import './TvmMark.css';

export type TvmMarkSize = 'sm' | 'md' | 'lg';

interface TvmMarkProps {
  size?: TvmMarkSize;
  className?: string;
  animated?: boolean;
  /** Keep a quiet pulse going (loading screens). */
  loop?: boolean;
}

/**
 * The orbital TVM mark. Same PNG as the home-screen icon, so the thing you
 * tap to open the app and the thing on the sign-in screen are the same picture.
 */
export function TvmMark({ size = 'md', className, animated = false, loop = false }: TvmMarkProps): React.JSX.Element {
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
    <img
      className={classes}
      src="/tvm-icon.png"
      alt=""
      draggable={false}
    />
  );
}
