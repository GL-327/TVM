import type { ReactNode } from 'react';
import { introPlayedThisSession, shouldSkipIntro, TvmIntro, type TvmIntroVariant } from '../brand/TvmIntro';
import { TvmMark } from '../brand/TvmMark';

interface LoadingScreenProps {
  eyebrow?: string;
  title: string;
  body: string;
  actions?: ReactNode;
  variant?: TvmIntroVariant;
  holdIfRecent?: boolean;
}

export function LoadingScreen({
  eyebrow = 'Please wait',
  title,
  body,
  actions,
  variant = 'tvm',
  holdIfRecent = false,
}: LoadingScreenProps): React.JSX.Element {
  if (shouldSkipIntro() || introPlayedThisSession()) {
    return (
      <section className="loading-state loading-state--plate" role="status" aria-live="polite" aria-busy="true">
        <TvmMark size="md" animated loop />
        <p className="stage__kicker">{eyebrow}</p>
        <h2 className="empty-state__title">{title}</h2>
        <p className="page__lede">{body}</p>
        <div className="loading-state__track" aria-hidden="true">
          <span className="loading-state__bar" />
        </div>
        {actions !== undefined && <div className="hero__actions">{actions}</div>}
      </section>
    );
  }

  return (
    <div className="loading-sting" role="status" aria-live="polite" aria-busy="true">
      <TvmIntro
        variant={variant}
        pending
        holdIfRecent={holdIfRecent}
        skippable={actions === undefined}
        onDone={() => undefined}
      />
      {actions !== undefined && <div className="loading-sting__actions">{actions}</div>}
    </div>
  );
}
