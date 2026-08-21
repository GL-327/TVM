interface SkeletonProps {
  className?: string;
  label?: string;
  /** Visual placeholder only — never focusable, never announced. */
  decorative?: boolean;
}

export function Skeleton({
  className,
  label = 'Loading',
  decorative = false,
}: SkeletonProps): React.JSX.Element {
  if (decorative) {
    return <span className={['skeleton', className].filter(Boolean).join(' ')} aria-hidden="true" />;
  }
  return (
    <span
      className={['skeleton', className].filter(Boolean).join(' ')}
      role="status"
      aria-label={label}
      aria-live="polite"
    />
  );
}

export function RailSkeletons({
  count = 8,
  layout = 'portrait',
  label = 'Loading titles',
}: {
  count?: number;
  layout?: 'portrait' | 'landscape';
  label?: string;
}): React.JSX.Element {
  const tile = layout === 'landscape' ? 'skeleton--landscape' : 'skeleton--poster';
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className={tile} label={label} decorative={index > 0} />
      ))}
    </>
  );
}

export function ChannelSkeletons({
  count = 8,
  label = 'Loading channels',
}: {
  count?: number;
  label?: string;
}): React.JSX.Element {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="skeleton--channel" label={label} decorative={index > 0} />
      ))}
    </>
  );
}
