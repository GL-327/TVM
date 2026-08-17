import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { applyPlanClass, FALLBACK_PLAN, fetchPlan, type PlanDefinition, type PlanStatus } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Plans(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);

  useEffect(() => {
    void fetchPlan().then((status) => {
      applyPlanClass(status);
      setPlan(status);
    });
  }, []);

  const catalog: PlanDefinition[] =
    plan.catalog.length > 0
      ? plan.catalog
      : [
          { id: 'free', name: 'TVM Free', price: 'Free', pricePence: 0, mocks: false, liveTv: false, extras: [] },
          { id: 'basic', name: 'TVM Basic', price: '£4.99', pricePence: 499, mocks: false, liveTv: false, extras: [] },
          { id: 'premium', name: 'TVM Premium', price: '£8.99', pricePence: 899, mocks: false, liveTv: false, extras: [] },
          { id: 'ultra', name: 'TVM Ultra', price: '£12.99', pricePence: 1299, mocks: true, liveTv: false, extras: [] },
          { id: 'max', name: 'TVM MAX', price: '£15.99', pricePence: 1599, mocks: true, liveTv: true, extras: [] },
        ];

  return (
    <main className="page page--settings">
      <TopBar title="Plans" />
      <p className="stage__kicker">Per month · mock payment</p>
      <h1 className="page__heading">Choose a plan</h1>
      <p className="page__lede">
        Current: {plan.name} ({plan.price}). Card details are checked on this machine and never stored.
      </p>
      <div className="plan-grid">
        {catalog.map((entry) => {
          const extras = entry.extras.length > 0 ? entry.extras : plan.catalog.find((item) => item.id === entry.id)?.extras ?? [];
          return (
            <FocusButton
              key={entry.id}
              id={`plan-${entry.id}`}
              className={`plan-card${plan.id === entry.id ? ' plan-card--on' : ''}`}
              onSelect={() =>
                navigate.push('checkout', {
                  params: { planId: entry.id, name: entry.name, price: entry.price },
                })
              }
            >
              <span className="plan-card__price">{entry.price}</span>
              <strong className="plan-card__name">{entry.name}</strong>
              {plan.id === entry.id ? <span className="plan-card__now">Current</span> : null}
              <ul className="plan-card__list">
                {extras.slice(0, 5).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </FocusButton>
          );
        })}
      </div>
    </main>
  );
}
