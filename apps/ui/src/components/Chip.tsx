import type { ReactNode } from 'react';

interface ChipProps {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning';
}

export function Chip({ children, tone = 'neutral' }: ChipProps): React.JSX.Element {
  return <span className={`chip chip--${tone}`}>{children}</span>;
}
