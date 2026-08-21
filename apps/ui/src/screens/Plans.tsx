import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { applyPlanClass, FALLBACK_PLAN, fetchPlan, type PlanDefinition, type PlanStatus } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

const FALLBACK_CATALOG: PlanDefinition[] = [
  { id: 'free', name: 'TVM Free', price: 'Free', pricePence: 0, basePrice: 'Free', basePricePence: 0, liveTvAddonPence: 0, mocks: false, liveTv: false, extras: [] },
  { id: 'basic', name: 'TVM Basic', price: '£7.99', pricePence: 799, basePrice: '£4.99', basePricePence: 499, liveTvAddonPence: 300, mocks: false, liveTv: true, extras: [] },
  { id: 'premium', name: 'TVM Premium', price: '£11.99', pricePence: 1199, basePrice: '£8.99', basePricePence: 899, liveTvAddonPence: 300, mocks: false, liveTv: true, extras: [] },
  { id: 'ultra', name: 'TVM Ultra', price: '£15.99', pricePence: 1599, basePrice: '£12.99', basePricePence: 1299, liveTvAddonPence: 300, mocks: true, liveTv: true, extras: [] },
  { id: 'max', name: 'TVM MAX', price: '£18.99', pricePence: 1899, basePrice: '£15.99', basePricePence: 1599, liveTvAddonPence: 300, mocks: true, liveTv: true, extras: [] },
];

function gainLine(entry: PlanDefinition, current: PlanStatus): string | null {
  if (entry.id === current.id) return 'Your current plan';
  if (entry.mocks && !current.mocks) return 'Adds mock Netflix, Prime, Max and more';
  if (entry.id === 'ultra' || entry.id === 'max') return 'Adds 4K and mock streaming hubs';
  if (entry.id === 'premium' && current.id === 'basic') return 'Removes ads and the queue';
  if (entry.id === 'basic' && current.id === 'free') return 'Adds Live TV and skips the queue';
  return null;
}

export function Plans(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanStatus>(FALLBACK_PLAN);

  useEffect(() => {
    void fetchPlan().then((status) => {
      applyPlanClass(status);
      setPlan(status);
    });
  }, []);

  const catalog: PlanDefinition[] = plan.catalog.length > 0 ? plan.catalog : FALLBACK_CATALOG;

  return (
    <main className="page page--settings page--plans">
      <TopBar title="Plans" />
      <p className="stage__kicker">Per month · mock payment</p>
      <h1 className="page__heading">Upgrade TVM</h1>
      <section className="plan-current">
        <p className="plan-current__kicker">Current plan</p>
        <h2 className="plan-current__name">{plan.name}</h2>
        <p className="plan-current__price">
          {plan.price}
          {plan.liveTvOptional ? (plan.liveTv ? ' with Live TV' : ' without Live TV') : ''}
        </p>
        <p className="page__lede">
          Card details are checked on this machine and never stored. Live TV is a £3.00 add-on on paid plans — include
          it at checkout or turn it off later in Settings.
        </p>
      </section>
      <div className="plan-grid" data-wrap="grid">
        {catalog.map((entry) => {
          const extras = entry.extras.length > 0 ? entry.extras : plan.catalog.find((item) => item.id === entry.id)?.extras ?? [];
          const withoutLive = entry.basePrice ?? entry.price;
          const addon = entry.liveTvAddonPence ?? 0;
          const gain = gainLine(entry, plan);
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
              {gain !== null && plan.id !== entry.id ? <span className="plan-card__gain">{gain}</span> : null}
              {addon > 0 ? (
                <span className="plan-card__note">
                  {withoutLive} without Live TV · {entry.price} with Live TV
                </span>
              ) : (
                <span className="plan-card__note">TVM Stream only</span>
              )}
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
