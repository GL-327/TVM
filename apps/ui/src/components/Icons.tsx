interface IconProps {
  className?: string;
}

export function IconProfile({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="24" fill="currentColor" opacity="0.22" />
      <circle cx="24" cy="18" r="7" fill="currentColor" />
      <path d="M10 40c2.2-8 9-12 14-12s11.8 4 14 12" fill="currentColor" />
    </svg>
  );
}

export function IconInputs({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="6" y="8" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M14 16h8M19 12.5 22.5 16 19 19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="m19 19 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconHome({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M6.5 15.5 16 7l9.5 8.5V25a1.5 1.5 0 0 1-1.5 1.5h-5v-6h-6v6h-5A1.5 1.5 0 0 1 6.5 25Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconLive({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="5" y="9" width="22" height="14" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M11 26h10M12 6l4 3M20 6l-4 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconWatchlist({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M9 6.5h14v19l-7-4.5-7 4.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconApps({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="18" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="6" y="18" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="18" y="18" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconSettings({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="3.2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M16 6.5v2.4M16 23.1v2.4M6.5 16h2.4M23.1 16h2.4M9.2 9.2l1.7 1.7M21.1 21.1l1.7 1.7M9.2 22.8l1.7-1.7M21.1 10.9l1.7-1.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconChevronLeft({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M19.5 8 11 16l8.5 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPlay({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M11 7.5v17l14-8.5z" />
    </svg>
  );
}

export function IconPause({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <rect x="9" y="7" width="5" height="18" rx="1" />
      <rect x="18" y="7" width="5" height="18" rx="1" />
    </svg>
  );
}

export function IconVolume({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M6 13h4l6-5v16l-6-5H6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M20 12.5a5 5 0 0 1 0 7M23 10a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconVolumeMute({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M6 13h4l6-5v16l-6-5H6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="m20 12 7 8M27 12l-7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconRewind({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M15 8v16L4 16z" />
      <path d="M28 8v16L17 16z" />
    </svg>
  );
}

export function IconForward({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M4 8v16l11-8z" />
      <path d="M17 8v16l11-8z" />
    </svg>
  );
}
