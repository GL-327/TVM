import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { prefersReducedMotion } from '../theme/motion';

export type OrbitStage = 'finding' | 'connecting' | 'buffering';

export const ORBIT_BASE_REV_PER_SEC = 0.45;
export const ORBIT_MIN_SPEED_MULT = 0.35;
export const ORBIT_MAX_SPEED_MULT = 2.4;
const DAMP_OMEGA = 10; // critically damped ~400ms settle (tau ~ 1/10 -> 4*tau = 400ms)

export function clampOrbitMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(ORBIT_MIN_SPEED_MULT, Math.min(ORBIT_MAX_SPEED_MULT, value));
}

export function speedMultiplierFromRate(bytesPerSec: number, referenceBps = 2_500_000): number {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return ORBIT_MIN_SPEED_MULT;
  return clampOrbitMultiplier(bytesPerSec / referenceBps);
}

/** Single critically damped spring step approaching `target` (`zeta = 1`). */
export function stepCriticallyDamped(
  current: number,
  velocity: number,
  target: number,
  dtSeconds: number,
  omega = DAMP_OMEGA,
): { value: number; velocity: number } {
  const dt = Math.max(0, Math.min(0.05, dtSeconds));
  const accel = omega * omega * (target - current) - 2 * omega * velocity;
  const nextVel = velocity + accel * dt;
  const nextVal = current + nextVel * dt;
  return { value: clampOrbitMultiplier(nextVal), velocity: nextVel };
}

export function formatOrbitStatus(stage: OrbitStage, bufferFraction: number): string {
  if (stage === 'finding') return 'Finding the best stream';
  if (stage === 'connecting') return 'Connecting';
  const pct = Math.max(0, Math.min(100, Math.round(bufferFraction * 100)));
  return `Buffering ${pct}%`;
}

function readBufferedAheadRatio(video: HTMLVideoElement | null | undefined): { ratio: number; bufferedEnd: number } {
  if (video == null || video.buffered.length === 0) return { ratio: 0, bufferedEnd: 0 };
  try {
    const now = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    let maxEnd = 0;
    for (let i = 0; i < video.buffered.length; i += 1) {
      const start = video.buffered.start(i);
      const end = video.buffered.end(i);
      if (end > maxEnd) maxEnd = end;
      if (now >= start - 0.5 && now <= end + 0.5) {
        const ahead = Math.max(0, end - now);
        return { ratio: Math.min(1, ahead / 6), bufferedEnd: maxEnd };
      }
    }
    return { ratio: Math.min(1, Math.max(0, maxEnd - now) / 6), bufferedEnd: maxEnd };
  } catch {
    return { ratio: 0, bufferedEnd: 0 };
  }
}

export interface OrbitLoaderProps {
  video?: HTMLVideoElement | null;
  hls?: Hls | null;
  stage?: OrbitStage;
  progress?: number;
  size?: 'md' | 'lg';
  statusText?: string;
  className?: string;
}

const STYLES = `
.orbit-loader {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.9rem;
  pointer-events: none;
  user-select: none;
}

.orbit-loader__ring {
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 999px;
}

.orbit-loader--md .orbit-loader__ring {
  width: 76px;
  height: 76px;
}

.orbit-loader--lg .orbit-loader__ring {
  width: 104px;
  height: 104px;
}

.orbit-loader__svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.orbit-loader__status {
  margin: 0;
  color: var(--tvm-glass27-text, rgba(255, 255, 255, 0.92));
  font-size: 0.96rem;
  font-weight: 580;
  letter-spacing: 0.01em;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
}

.orbit-loader__pulse {
  animation: orbit-pulse 1.5s ease-in-out infinite alternate;
}

@keyframes orbit-pulse {
  from { opacity: 0.45; }
  to { opacity: 1; }
}
`;

/**
 * TVM 1.1 orbital loading indicator (F5): glass halo + comet arc + 3 trailing
 * particles driven at 0.35x-2.4x of 0.45 rev/s by real HLS fragment / media
 * buffer arrival speed, critically damped over ~400ms.
 */
export function OrbitLoader({
  video,
  hls,
  stage = 'buffering',
  progress,
  size = 'lg',
  statusText,
  className,
}: OrbitLoaderProps): React.JSX.Element {
  const [angleDeg, setAngleDeg] = useState(0);
  const [bufferFrac, setBufferFrac] = useState(() =>
    progress ?? (stage === 'finding' ? 0.12 : stage === 'connecting' ? 0.28 : 0.08),
  );
  const targetMultRef = useRef(stage === 'finding' ? 0.72 : 1.0);
  const currentMultRef = useRef(targetMultRef.current);
  const multVelRef = useRef(0);
  const angleRef = useRef(0);
  const lastPacketAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  const lastBufferedEndRef = useRef(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (hls == null) return undefined;
    const onFragLoaded = (_event: unknown, data: unknown): void => {
      const payload = data as { frag?: { stats?: { loaded?: number; loading?: { start?: number; end?: number } } } };
      const stats = payload?.frag?.stats;
      const loaded = stats?.loaded ?? 0;
      const start = stats?.loading?.start ?? 0;
      const end = stats?.loading?.end ?? 0;
      const ms = Math.max(16, end - start);
      const bps = (loaded / ms) * 1000;
      targetMultRef.current = speedMultiplierFromRate(bps);
      lastPacketAtRef.current = performance.now();
    };
    hls.on('hlsFragLoaded' as Parameters<Hls['on']>[0], onFragLoaded);
    return () => {
      hls.off('hlsFragLoaded' as Parameters<Hls['on']>[0], onFragLoaded);
    };
  }, [hls]);

  useEffect(() => {
    if (video == null) return undefined;
    let lastAt = performance.now();
    const onProgress = (): void => {
      const now = performance.now();
      const { ratio, bufferedEnd } = readBufferedAheadRatio(video);
      setBufferFrac((prev) => (ratio > 0 ? ratio : prev));
      const deltaSec = Math.max(0, bufferedEnd - lastBufferedEndRef.current);
      const elapsedSec = Math.max(0.05, (now - lastAt) / 1000);
      if (deltaSec > 0) {
        const bufferSpeed = deltaSec / elapsedSec; // buffer-seconds per wall second
        targetMultRef.current = clampOrbitMultiplier(bufferSpeed / 1.5);
        lastPacketAtRef.current = now;
      }
      lastBufferedEndRef.current = bufferedEnd;
      lastAt = now;
    };
    const onWaiting = (): void => {
      targetMultRef.current = ORBIT_MIN_SPEED_MULT;
    };
    video.addEventListener('progress', onProgress);
    video.addEventListener('timeupdate', onProgress);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onWaiting);
    return () => {
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('timeupdate', onProgress);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onWaiting);
    };
  }, [video]);

  useEffect(() => {
    if (progress !== undefined) {
      setBufferFrac(Math.max(0, Math.min(1, progress)));
    } else if (stage === 'finding') {
      setBufferFrac(0.14);
      targetMultRef.current = 0.72;
    } else if (stage === 'connecting') {
      setBufferFrac(0.28);
      targetMultRef.current = 0.95;
    }
  }, [progress, stage]);

  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== 'function') return undefined;
    let raf = 0;
    let prevTime = performance.now();

    const frame = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0.001, (now - prevTime) / 1000));
      prevTime = now;

      if (now - lastPacketAtRef.current > 850) {
        // Drift speed gently down during stalls or metadata waits.
        targetMultRef.current = stage === 'buffering' ? ORBIT_MIN_SPEED_MULT : 0.72;
      }

      const stepped = stepCriticallyDamped(
        currentMultRef.current,
        multVelRef.current,
        targetMultRef.current,
        dt,
      );
      currentMultRef.current = stepped.value;
      multVelRef.current = stepped.velocity;

      angleRef.current = (angleRef.current + 360 * ORBIT_BASE_REV_PER_SEC * stepped.value * dt) % 360;
      setAngleDeg(angleRef.current);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced, stage]);

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const fillLength = Math.max(circumference * 0.08, circumference * Math.min(1, Math.max(0, bufferFrac)));
  const label = statusText ?? formatOrbitStatus(stage, bufferFrac);

  return (
    <div className={`orbit-loader orbit-loader--${size}${className ? ` ${className}` : ''}`}>
      <style href="tvm-orbit-loader" precedence="player">{STYLES}</style>
      <div className="orbit-loader__ring glass glass--chrome" aria-hidden="true">
        <svg className="orbit-loader__svg" viewBox="0 0 100 100">
          {/* Base circular rim */}
          <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="3.5" />
          {/* Thin buffer fill arc */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="var(--player-fill, #6ec8ff)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${fillLength} ${circumference}`}
            transform="rotate(-90 50 50)"
            className={reduced ? 'orbit-loader__pulse' : undefined}
          />
          {/* Orbiting comet arc + 3 trailing particles */}
          <g transform={reduced ? undefined : `rotate(${angleDeg} 50 50)`} className={reduced ? 'orbit-loader__pulse' : undefined}>
            <path
              d="M 50 10 A 40 40 0 0 1 84.6 30"
              fill="none"
              stroke="rgba(255,255,255,0.96)"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
            <circle cx="88.5" cy="39.5" r="2.6" fill="rgba(255,255,255,0.78)" />
            <circle cx="89.5" cy="52" r="2.0" fill="rgba(255,255,255,0.48)" />
            <circle cx="84.5" cy="66" r="1.5" fill="rgba(255,255,255,0.24)" />
          </g>
        </svg>
      </div>
      <p className="orbit-loader__status">{label}</p>
    </div>
  );
}
