import { FocusButton } from './FocusButton';

interface ErrorStateProps {
  title: string;
  body: string;
  onRetry?: () => void;
  onBack?: () => void;
}

export function ErrorState({ title, body, onRetry, onBack }: ErrorStateProps): React.JSX.Element {
  return (
    <section className="error-state" role="alert">
      <p className="stage__kicker">Something went wrong</p>
      <h2 className="empty-state__title">{title}</h2>
      <p className="page__lede">{body}</p>
      <div className="hero__actions">
        {onRetry !== undefined && (
          <FocusButton id="retry" variant="primary" onSelect={onRetry}>
            Retry
          </FocusButton>
        )}
        {onBack !== undefined && (
          <FocusButton id="back" onSelect={onBack}>
            Back
          </FocusButton>
        )}
      </div>
    </section>
  );
}
