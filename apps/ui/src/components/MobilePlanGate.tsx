import { useEffect, useState, type ReactNode } from 'react';
import { fetchPlan, type PlanStatus } from '../data/plan';
import { isMobileClient, mobilePlanAllowed, MOBILE_PLAN_EVENT } from '../data/mobileAccess';
import { useNavigate } from '../nav/ViewStackContext';
import { FocusButton } from './FocusButton';

const SETUP_SCREENS = new Set(['plans', 'donate', 'accounts', 'settings', 'profile', 'developer', 'developer-unlock', 'mail-settings', 'legal', 'notice', 'confirm', 'changelog', 'updates', 'realdebrid', 'setup', 'recovery', 'system-info']);

export function MobilePlanGate({ screen, children }: { screen: string; children: ReactNode }): React.JSX.Element {
  const mobile = isMobileClient();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanStatus | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!mobile) return;
    const controller = new AbortController();
    setError(false);
    void fetchPlan(controller.signal, true).then((value) => {
      if (!controller.signal.aborted) setPlan(value);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    const changed = (event: Event): void => setPlan((event as CustomEvent<PlanStatus>).detail);
    window.addEventListener(MOBILE_PLAN_EVENT, changed);
    return () => { controller.abort(); window.removeEventListener(MOBILE_PLAN_EVENT, changed); };
  }, [mobile, screen, attempt]);

  if (!mobile || SETUP_SCREENS.has(screen) || (plan !== null && mobilePlanAllowed(plan))) return <>{children}</>;
  return <main className="page page--settings mobile-plan-gate">
    <p className="stage__kicker">TVM on iOS &amp; Android</p>
    <h1 className="page__heading">{error ? 'Could not check your plan' : plan ? 'Take TVM with you' : 'Checking your plan…'}</h1>
    <p className="page__lede">{error ? 'Check your connection, then try again.' : 'Watching on a phone or tablet is included with Premium, Ultra and MAX, in Full HD (1080p) or better. Free and Basic play on your television and desktop.'}</p>
    <div className="hero__actions">
      {error && <FocusButton id="mobile-retry" onSelect={() => { setPlan(null); setAttempt((value) => value + 1); }}>Retry</FocusButton>}
      <FocusButton id="mobile-plans" variant="primary" onSelect={() => navigate.push('plans')}>View plans</FocusButton>
      <FocusButton id="mobile-settings" onSelect={() => navigate.push('settings')}>Settings &amp; testing</FocusButton>
    </div>
  </main>;
}
