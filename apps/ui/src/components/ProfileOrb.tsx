interface ProfileOrbProps {
  name: string;
  hue: number;
  size?: 'sm' | 'lg';
}

export function ProfileOrb({ name, hue, size = 'sm' }: ProfileOrbProps): React.JSX.Element {
  return (
    <span
      className={`profile-orb profile-orb--${size}`}
      style={{ background: `hsl(${hue} 72% 46%)` }}
      title={name}
      aria-hidden="true"
    >
      <span className="profile-orb__face">
        <span className="profile-orb__eye" />
        <span className="profile-orb__eye" />
        <span className="profile-orb__smile" />
      </span>
    </span>
  );
}
