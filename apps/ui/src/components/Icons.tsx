interface IconProps {
  className?: string;
}

export function IconProfile({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <circle cx="16" cy="12" r="5" stroke="currentColor" strokeWidth="2" />
      <path d="M6.5 26.5a9.5 9.5 0 0 1 19 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconInputs({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <rect x="6" y="8" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M14 16h8M19 12.5 22.5 16 19 19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <circle cx="14" cy="14" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="m19 19 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconHome({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
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
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <rect x="5" y="9" width="22" height="14" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M11 26h10M12 6l4 3M20 6l-4 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconWatchlist({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path d="M9 6.5h14v19l-7-4.5-7 4.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconApps({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <rect x="6" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="18" y="6" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="6" y="18" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <rect x="18" y="18" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconStream({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="4.5" y="7.5" width="23" height="17" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M13.5 13.2v5.6l5-2.8Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSettings({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
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
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path d="M19.5 8 11 16l8.5 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPlay({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" overflow="hidden" aria-hidden="true">
      <path d="M11 7.5v17l14-8.5z" />
    </svg>
  );
}

export function IconPause({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" overflow="hidden" aria-hidden="true">
      <rect x="9" y="7" width="5" height="18" rx="1" />
      <rect x="18" y="7" width="5" height="18" rx="1" />
    </svg>
  );
}

export function IconVolume({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path d="M6 13h4l6-5v16l-6-5H6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M20 12.5a5 5 0 0 1 0 7M23 10a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconVolumeMute({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path d="M6 13h4l6-5v16l-6-5H6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="m20 12 7 8M27 12l-7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconRewind({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path d="M20.2 8.4a9.2 9.2 0 1 0 7 8.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M19.2 8.2h4.6V4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="16" y="21.2" textAnchor="middle" fill="currentColor" fontSize="9.5" fontWeight="700">10</text>
    </svg>
  );
}

export function IconForward({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path d="M11.8 8.4a9.2 9.2 0 1 1 -7 8.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12.8 8.2H8.2V4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="16" y="21.2" textAnchor="middle" fill="currentColor" fontSize="9.5" fontWeight="700">10</text>
    </svg>
  );
}

export function IconEye({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path
        d="M4.5 16s4.2-6.5 11.5-6.5S27.5 16 27.5 16s-4.2 6.5-11.5 6.5S4.5 16 4.5 16Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3.2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function IconEyeOff({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path
        d="M5.5 5.5 26.5 26.5M12.5 10.1a10.7 10.7 0 0 1 3.5-.6c7.3 0 11.5 6.5 11.5 6.5a21 21 0 0 1-4.3 4.6M8.2 11.8A20.3 20.3 0 0 0 4.5 16s4.2 6.5 11.5 6.5c1.5 0 2.9-.3 4.2-.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCheck({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <path d="m7.5 16.5 5.5 5.5 11.5-12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconAlertCircle({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16 10.8v6.2M16 21.2h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconClock({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16 10.5V16l4 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconAccountPaused({ className }: IconProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" overflow="hidden" aria-hidden="true">
      <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeWidth="2" />
      <path d="M13.5 12v8M18.5 12v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
