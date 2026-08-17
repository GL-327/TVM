import type { ReactNode } from 'react';

interface EmptyStateProps {
  eyebrow?: string;
  title: string;
  body: string;
  actions?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  eyebrow,
  title,
  body,
  actions,
  compact = false,
}: EmptyStateProps): React.JSX.Element {
  return (
    <section className={`empty-state${compact ? ' empty-state--compact' : ''}`}>
      {eyebrow !== undefined && <p className="stage__kicker">{eyebrow}</p>}
      <h2 className="empty-state__title">{title}</h2>
      <p className="page__lede">{body}</p>
      {actions !== undefined && <div className="hero__actions">{actions}</div>}
    </section>
  );
}
