import { useState } from 'react';
import { bumpMarkEgg } from '../brand/easterEggs';
import { TvmMark } from '../brand/TvmMark';
import { FocusButton } from './FocusButton';

interface BrandLockupProps {
  kind?: 'stream' | 'wordmark';
  /** Remote-friendly 7-press egg when the lockup sits in a focus row. */
  focusId?: string;
  className?: string;
}

function LockupFace({ kind }: { kind: 'stream' | 'wordmark' }): React.JSX.Element {
  return (
    <>
      <TvmMark size="sm" className="tvm-lockup__mark" />
      <span className="tvm-lockup__word">{kind === 'wordmark' ? 'TVM' : 'tvm stream'}</span>
    </>
  );
}

export function BrandLockup({ kind = 'stream', focusId, className }: BrandLockupProps): React.JSX.Element {
  const [, setTaps] = useState(0);
  const bump = (): void => {
    setTaps((count) => bumpMarkEgg(count));
  };
  const classes = ['tvm-lockup', `tvm-lockup--${kind}`, className].filter(Boolean).join(' ');

  if (focusId !== undefined) {
    return (
      <FocusButton id={focusId} className={`tvm-lockup-btn ${classes}`} onSelect={bump}>
        <LockupFace kind={kind} />
      </FocusButton>
    );
  }

  return (
    <span className={classes} onClick={bump}>
      <LockupFace kind={kind} />
    </span>
  );
}
