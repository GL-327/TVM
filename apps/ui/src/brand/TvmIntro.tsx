import { useEffect, useRef, useState } from 'react';
import { TvmMark } from './TvmMark';
import './TvmIntro.css';

export type TvmIntroVariant = 'tvm' | 'stream';

interface TvmIntroProps {
  variant?: TvmIntroVariant;
  /** Keep the last frame on screen until the destination is ready. */
  pending?: boolean;
  /** After a boot sting, Home can hold this frame instead of playing again. */
  holdIfRecent?: boolean;
  /** OK / click skip. Loaders with their own Back control pass false. */
  skippable?: boolean;
  onDone: () => void;
}

const ANIM_MS = 3200;
const FADE_MS = 420;
const REDUCE_MS = 280;
const HOLD_MAX_MS = 2800;
const INTRO_STAMP = 'tvm.intro.at';
const INTRO_SESSION = 'tvm.intro.session';
const INTRO_STREAM = 'tvm.intro.stream';
let introPlayedMem = false;
const MOTES = [0, 1, 2, 3, 4, 5] as const;
const RAYS = [0, 1, 2, 3] as const;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function markIntroPlayed(kind: TvmIntroVariant = 'tvm'): void {
  introPlayedMem = true;
  try {
    sessionStorage.setItem(INTRO_STAMP, String(Date.now()));
    sessionStorage.setItem(INTRO_SESSION, '1');
    if (kind === 'stream') sessionStorage.setItem(INTRO_STREAM, '1');
  } catch {
    /* private mode */
  }
}

export function introPlayedThisSession(): boolean {
  if (introPlayedMem) return true;
  try {
    return sessionStorage.getItem(INTRO_SESSION) === '1';
  } catch {
    return false;
  }
}

export function streamIntroPlayedThisSession(): boolean {
  try {
    return sessionStorage.getItem(INTRO_STREAM) === '1';
  } catch {
    return false;
  }
}

export function introPlayedRecently(windowMs = 10_000): boolean {
  try {
    if (sessionStorage.getItem(INTRO_SESSION) === '1') return true;
    const at = Number(sessionStorage.getItem(INTRO_STAMP) ?? '0');
    return Number.isFinite(at) && Date.now() - at < windowMs;
  } catch {
    return false;
  }
}

export function shouldSkipIntro(): boolean {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('skipIntro') === '1' || params.get('e2e') === '1';
  } catch {
    return false;
  }
}

/**
 * Full-screen open sting for TVM and TVM Stream. Skip with OK, Enter, Escape,
 * or a click. Holds on the logo if `pending` is still true after the sting.
 */
export function TvmIntro({
  variant = 'tvm',
  pending = false,
  holdIfRecent = false,
  skippable = true,
  onDone,
}: TvmIntroProps): React.JSX.Element | null {
  const doneRef = useRef(onDone);
  const skipped = useRef(false);
  const alreadyPlayed = useRef(introPlayedThisSession()).current;
  const [animDone, setAnimDone] = useState(
    () => alreadyPlayed || reducedMotion() || (holdIfRecent && introPlayedRecently()),
  );
  const [leaving, setLeaving] = useState(false);
  doneRef.current = onDone;
  const stream = variant === 'stream';

  const close = (): void => {
    if (skipped.current) return;
    skipped.current = true;
    setLeaving(true);
    window.setTimeout(() => doneRef.current(), reducedMotion() ? 160 : FADE_MS);
  };

  useEffect(() => {
    if (alreadyPlayed && !pending) {
      doneRef.current();
      return undefined;
    }
    markIntroPlayed(variant);
    if (animDone) return undefined;
    const hold = reducedMotion() ? REDUCE_MS : ANIM_MS;
    const timer = window.setTimeout(() => setAnimDone(true), hold);
    return () => window.clearTimeout(timer);
  }, [alreadyPlayed, animDone, pending, variant]);

  useEffect(() => {
    if (!skippable) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === 'Escape' || event.key === ' ') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skippable]);

  useEffect(() => {
    if (skipped.current || !animDone || pending) return undefined;
    close();
    return undefined;
  }, [animDone, pending]);

  useEffect(() => {
    if (!animDone || !pending) return undefined;
    const timer = window.setTimeout(() => close(), HOLD_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [animDone, pending]);

  const holding = pending && animDone && !leaving;

  if (alreadyPlayed && !pending) return null;

  return (
    <div
      className={`tvm-intro${leaving ? ' tvm-intro--out' : ''}${stream ? ' tvm-intro--stream' : ''}${holding ? ' tvm-intro--hold' : ''}`}
      role="dialog"
      aria-label={stream ? 'TVM Stream' : 'TVM'}
      onClick={skippable ? close : undefined}
    >
      <div className="tvm-intro__wash" aria-hidden="true" />
      <div className="tvm-intro__field" aria-hidden="true">
        <span className="tvm-intro__bloom" />
        <span className="tvm-intro__ring" />
        <span className="tvm-intro__ring tvm-intro__ring--mid" />
        <span className="tvm-intro__flare" />
        {MOTES.map((index) => (
          <span key={index} className={`tvm-intro__mote tvm-intro__mote--${index}`} />
        ))}
      </div>
      <div className="tvm-intro__stage">
        <div className="tvm-intro__mark">
          {RAYS.map((index) => (
            <span key={index} className={`tvm-intro__ray tvm-intro__ray--${index}`} />
          ))}
          <TvmMark size="lg" animated loop={holding} />
        </div>
        <p className="tvm-intro__word" aria-hidden="true">
          <span>T</span>
          <span>V</span>
          <span>M</span>
          <i className="tvm-intro__sheen" />
        </p>
        <p className="tvm-intro__tag">{stream ? 'STREAM' : 'WATCH'}</p>
      </div>
      {skippable ? <p className="tvm-intro__skip">Press OK to skip</p> : null}
    </div>
  );
}
