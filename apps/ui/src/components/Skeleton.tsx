interface SkeletonProps {
  className?: string;
  label?: string;
}

export function Skeleton({ className, label = 'Loading' }: SkeletonProps): React.JSX.Element {
  return (
    <span
      className={['skeleton', className].filter(Boolean).join(' ')}
      role="status"
      aria-label={label}
      aria-live="polite"
    />
  );
}
