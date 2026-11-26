import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../theme/motion';
import type { IntroPick } from './introLogic';
import { createIntroScene } from './scenes';
import './franchiseIntro.css';

/** Length of the crossfade into the video. */
export const INTRO_FADE_MS = 450;
const SKIP_FADE_MS = 220;
const REDUCED_MS = 1500;
const REDUCED_RELEASE_MS = 1050;

export interface FranchiseIntroProps {
  pick: IntroPick;
  /** The crossfade has begun: the video may start now. Fires once. */
  onRelease: () => void;
  /** The overlay is fully faded: remove it. Fires once. */
  onDone: () => void;
}

/**
 * Full-screen franchise intro drawn over the loading phase. It plays for its
 * set length, then crossfades away. Any key, click or tap skips it.
 */
export function FranchiseIntro({ pick, onRelease, onDone }: FranchiseIntroProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cb = useRef({ onRelease, onDone });
  cb.current = { onRelease, onDone };
  const reduced = useRef(prefersReducedMotion()).current;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (root === null) return undefined;
    let released = false;
    let finished = false;
    let leaving = false;
    let raf = 0;
    let started = 0;
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const total = reduced ? REDUCED_MS : pick.intro.durationMs;

    const release = (): void => {
      if (released) return;
      released = true;
      cb.current.onRelease();
    };
    const finish = (): void => {
      if (finished) return;
      finished = true;
      release();
      cb.current.onDone();
    };
    const leave = (fadeMs: number): void => {
      if (leaving) return;
      leaving = true;
      root.style.setProperty('--intro-fade', `${fadeMs}ms`);
      root.classList.add('is-leaving');
      release();
      timers.push(setTimeout(finish, fadeMs));
    };
    const skip = (): void => leave(SKIP_FADE_MS);

    const onKey = (): void => skip();
    window.addEventListener('keydown', onKey, true);
    root.addEventListener('pointerdown', skip);

    const begin = (): void => {
      if (disposed) return;
      started = performance.now();
      timers.push(setTimeout(() => leave(reduced ? 380 : INTRO_FADE_MS), (reduced ? REDUCED_RELEASE_MS : total - INTRO_FADE_MS)));
      timers.push(setTimeout(finish, total + 400));
      if (reduced || canvas === null) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx === null) {
        leave(SKIP_FADE_MS);
        return;
      }
      const scene = createIntroScene(pick);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      let cw = 0;
      let ch = 0;
      const fit = (): void => {
        const rect = root.getBoundingClientRect();
        const nw = Math.max(2, Math.round(rect.width));
        const nh = Math.max(2, Math.round(rect.height));
        if (nw === cw && nh === ch) return;
        cw = nw;
        ch = nh;
        canvas.width = Math.round(nw * dpr);
        canvas.height = Math.round(nh * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        scene.resize(nw, nh);
      };
      fit();
      const frame = (): void => {
        if (disposed) return;
        fit();
        scene.draw(ctx, Math.min(total, performance.now() - started));
        raf = requestAnimationFrame(frame);
      };
      frame();
    };

    // The title fonts are small; give them a moment so the first frame already uses them.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!reduced && fonts !== undefined) {
      const wait = new Promise<void>((resolve) => timers.push(setTimeout(resolve, 220)));
      void Promise.race([wait, Promise.all([fonts.load('800 48px Geist'), fonts.load('600 24px Geist')]).then(() => undefined)])
        .catch(() => undefined)
        .then(begin);
    } else {
      begin();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onKey, true);
      root.removeEventListener('pointerdown', skip);
    };
  }, [pick, reduced]);

  return (
    <div
      ref={rootRef}
      className={`franchise-intro franchise-intro--${pick.intro.style}${reduced ? ' franchise-intro--reduced' : ''}`}
      data-franchise-intro={pick.intro.id}
      style={{ '--intro-accent': pick.intro.accent, '--intro-glow': pick.intro.glow } as React.CSSProperties}
      role="presentation"
    >
      {reduced ? (
        <div className="franchise-intro__card">
          <strong>{pick.intro.style === 'doom' ? pick.title : 'The Hunger Games'}</strong>
          {pick.intro.style === 'doom' || pick.title === '' ? null : <span>{pick.title}</span>}
        </div>
      ) : (
        <canvas ref={canvasRef} className="franchise-intro__canvas" aria-hidden="true" />
      )}
      <span className="franchise-intro__skip" aria-hidden="true">Press any key to skip</span>
    </div>
  );
}
