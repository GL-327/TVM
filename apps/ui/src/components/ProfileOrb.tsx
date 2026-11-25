import { useState } from 'react';
import { getAvatarsContent } from '../data/content';

interface ProfileOrbProps {
  name: string;
  hue: number;
  avatar?: string | null;
  locked?: boolean;
  size?: 'sm' | 'lg';
}

export function resolveAvatarImageUrl(avatar: string | null | undefined): string | null {
  if (typeof avatar !== 'string' || !avatar.includes('/')) return null;
  const [setId, avatarId] = avatar.split('/');
  const sets = getAvatarsContent().sets;
  const set = sets.find((s) => s.id === setId);
  const hit = set?.avatars.find((a) => a.id === avatarId);
  return hit?.image ?? null;
}

export function ProfileOrb({ name, hue, avatar, locked = false, size = 'sm' }: ProfileOrbProps): React.JSX.Element {
  const [imgFailed, setImgFailed] = useState(false);
  const src = imgFailed ? null : resolveAvatarImageUrl(avatar);
  const initial = (name.trim().charAt(0) || '?').toUpperCase();

  return (
    <span
      className={`profile-orb profile-orb--${size}${src !== null ? ' profile-orb--photo' : ''}`}
      style={{ background: `hsl(${hue} 72% 46%)` }}
      title={name}
      aria-hidden="true"
    >
      {src !== null ? (
        <img
          src={src}
          alt=""
          className="profile-orb__img"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="profile-orb__initial">{initial}</span>
      )}
      {locked && (
        <span className="profile-orb__lock" title="PIN locked">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </span>
  );
}
