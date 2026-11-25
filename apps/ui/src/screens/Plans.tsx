import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { GlassSegmented } from '../components/GlassSegmented';
import { IconCheck } from '../components/Icons';
import { PageScene } from '../components/PageScene';
import { TopBar } from '../components/TopBar';
import {
  fetchAccount,
  fetchTiers,
  recordPlanChoice,
  type AccessTierView,
  type AccountState,
  type TiersResponse,
} from '../data/account';
import { formatBillingMoney } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { friendlyPlanName } from './accountCopy';
import './plans.css';

type BillingCadence = 'month' | 'year';

function formatCleanPrice(pence: number): string {
  if (pence % 100 === 0) return `£${pence / 100}`;
  return formatBillingMoney(pence);
}

function tierDisplayName(tier: AccessTierView): string {
  return tier.id === 'stream-live' ? 'Stream + Live' : 'Stream';
}

function tierButtonLabel(tier: AccessTierView, mine: boolean, comingSoon: boolean): string {
  if (mine) return 'Current plan';
  if (comingSoon) return 'Coming soon';
  return `Choose ${tierDisplayName(tier)}`;
}

function tierPricePence(tier: AccessTierView, cadence: BillingCadence): number | null {
  if (cadence === 'year') {
    if (typeof tier.yearlyPence !== 'number' || tier.yearlyPence <= 0) return null;
    const addon = typeof tier.liveTvYearlyPence === 'number' ? tier.liveTvYearlyPence : 0;
    return tier.yearlyPence + addon;
  }
  if (tier.monthlyPence === null) return null;
  const addon = typeof tier.liveTvMonthlyPence === 'number' ? tier.liveTvMonthlyPence : 0;
  return tier.monthlyPence + addon;
}

function yearlySavingsPercent(tiers: readonly AccessTierView[]): number {
  const base = tiers[0];
  if (!base || base.monthlyPence === null || base.monthlyPence <= 0 || typeof base.yearlyPence !== 'number' || base.yearlyPence <= 0) {
    return 0;
  }
  const annualAtMonthly = base.monthlyPence * 12;
  if (base.yearlyPence >= annualAtMonthly) return 0;
  return Math.round(((annualAtMonthly - base.yearlyPence) / annualAtMonthly) * 100);
}

function isRecommendedTier(tier: AccessTierView, tiers: readonly AccessTierView[]): boolean {
  const streamLive = tiers.find((item) => item.id === 'stream-live');
  const liveOrderable = streamLive !== undefined && streamLive.orderable !== false && streamLive.availability !== 'Coming soon';
  if (liveOrderable) return tier.id === 'stream-live';
  return tier.id === 'stream';
}

const COMPARE_ROWS: ReadonlyArray<{ label: string; stream: string; live: string }> = [
  { label: 'Films & series from your sources', stream: 'Included', live: 'Included' },
  { label: '4K HDR & Dolby Atmos', stream: 'Included', live: 'Included' },
  { label: 'Viewing profiles', stream: 'Up to 10', live: 'Up to 10' },
  { label: 'No ads, no queue, no hour limits', stream: 'Included', live: 'Included' },
  { label: 'Live TV (bring your IPTV)', stream: '—', live: 'Included' },
  { label: 'Channel check & catch-up live', stream: '—', live: 'Included' },
];

/**
 * Plans and access overview.
 *
 * TVM access is arranged directly with the app owner and no card is charged
 * on this page. The donate block remains clearly fenced off below.
 */
export function Plans(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [tiers, setTiers] = useState<TiersResponse | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [cadence, setCadence] = useState<BillingCadence>('month');
  const [showCompare, setShowCompare] = useState(false);
  const [choiceNote, setChoiceNote] = useState<string | null>(null);
  const [choosingId, setChoosingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchTiers().then((list) => { if (!cancelled) setTiers(list); });
    void fetchAccount().then((state) => { if (!cancelled) setAccount(state); });
    return () => { cancelled = true; };
  }, []);

  const tierList = tiers?.tiers ?? [];
  const hasYearly = tierList.some((tier) => typeof tier.yearlyPence === 'number' && tier.yearlyPence > 0);
  const savings = yearlySavingsPercent(tierList);
  const cadenceOptions = [
    { id: 'month' as const, label: 'Monthly' },
    { id: 'year' as const, label: savings > 0 ? `Yearly · Save ${savings}%` : 'Yearly' },
  ];

  const chooseTier = async (tier: AccessTierView): Promise<void> => {
    if (choosingId !== null) return;
    const comingSoon = tier.orderable === false || tier.availability === 'Coming soon';
    if (comingSoon) {
      setChoiceNote(`${tierDisplayName(tier)} is coming soon. Ask the app owner when Live TV opens.`);
      return;
    }
    setChoosingId(tier.id);
    setChoiceNote(null);
    try {
      const recorded = account?.signedIn
        ? await recordPlanChoice({ cadence, liveTv: tier.liveTv })
        : null;
      const emailPart = account?.account?.email ? ` for ${account.account.email}` : '';
      const planLabel = tierDisplayName(tier);
      if (recorded?.message) {
        setChoiceNote(`${planLabel} (${cadence === 'year' ? 'Yearly' : 'Monthly'}) noted${emailPart}. ${recorded.message}`);
      } else {
        setChoiceNote(`${planLabel} (${cadence === 'year' ? 'Yearly' : 'Monthly'}) selected${emailPart}. Ask the owner to switch it on — no card is taken here.`);
      }
    } finally {
      setChoosingId(null);
    }
  };

  return (
    <main className="page page--settings page--plans">
      <PageScene />
      <TopBar title="Plans" />

      <div className="plans-shell">
        <header className="plans-hero">
          <h1 className="page__heading">Choose your plan</h1>
          <p className="page__lede">
            Nothing to buy inside the app — access is arranged with the app owner, and no card is taken here.
          </p>
          {account?.account != null && (
            <p className="plans-account-note">
              Signed in as <strong>{account.account.email}</strong> ·{' '}
              {account.account.activated
                ? `Active (${friendlyPlanName(account.account.tier)})`
                : 'Waiting for approval'}
            </p>
          )}
          {hasYearly && (
            <div className="plans-toggle">
              <GlassSegmented
                idPrefix="plans-cadence"
                ariaLabel="Billing period"
                options={cadenceOptions}
                value={cadence}
                onChange={setCadence}
              />
            </div>
          )}
        </header>

        {tiers === null ? (
          <p className="plans-loading" role="status">Loading plans…</p>
        ) : (
          <>
            <div className="tier-grid" data-wrap="row">
              {tierList.map((tier) => {
                const mine = account?.account?.tier === tier.id && account.account.activated;
                const comingSoon = tier.orderable === false || tier.availability === 'Coming soon';
                const recommended = isRecommendedTier(tier, tierList);
                const pricePence = tierPricePence(tier, cadence);
                const fromTerm = tier.liveTvTerms.reduce<typeof tier.liveTvTerms[number] | null>(
                  (cheapest, term) => (cheapest === null || term.amountPence < cheapest.amountPence ? term : cheapest),
                  null,
                );
                const addonPence = cadence === 'year'
                  ? (tier.liveTvYearlyPence ?? 0)
                  : (tier.liveTvMonthlyPence ?? 0);
                const isPrimary = recommended && !mine && !comingSoon;

                return (
                  <article
                    key={tier.id}
                    className={`glass glass--card tier-card${recommended ? ' tier-card--popular' : ''}${mine ? ' tier-card--mine' : ''}`}
                  >
                    <div className="tier-card__top">
                      <div className="tier-card__badges">
                        {recommended && <span className="tier-card__badge">Most popular</span>}
                        {mine && <span className="tier-card__badge tier-card__badge--mine">Your plan</span>}
                        {comingSoon && !mine && <span className="tier-card__badge tier-card__badge--muted">Coming soon</span>}
                      </div>

                      <h2 className="tier-card__name">{tierDisplayName(tier)}</h2>
                      <p className="tier-card__summary">{tier.summary}</p>

                      {pricePence !== null && (
                        <div className="tier-card__pricing">
                          <p className="tier-card__price">
                            <span className="tier-card__amount">{formatCleanPrice(pricePence)}</span>
                            <span className="tier-card__unit">per {cadence === 'year' ? 'year' : 'month'}</span>
                          </p>
                          {addonPence > 0 && (
                            <p className="tier-card__price-note">
                              Includes {formatCleanPrice(addonPence)} Live TV add-on
                            </p>
                          )}
                          {addonPence === 0 && fromTerm !== null && (
                            <p className="tier-card__price-note">
                              Plus Live TV from {formatCleanPrice(fromTerm.amountPence)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <ul className="tier-card__list">
                      {tier.includes.slice(0, 5).map((line) => (
                        <li key={line}>
                          <IconCheck className="tier-card__check" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="tier-card__action">
                      <FocusButton
                        id={`plan-choose-${tier.id}`}
                        variant={isPrimary ? 'primary' : 'standard'}
                        className={isPrimary ? 'tier-card__cta' : 'tvm-button--glass tier-card__cta'}
                        disabled={mine || comingSoon || choosingId !== null}
                        onSelect={() => void chooseTier(tier)}
                      >
                        {choosingId === tier.id ? 'Noting choice…' : tierButtonLabel(tier, mine, comingSoon)}
                      </FocusButton>
                    </div>
                  </article>
                );
              })}
            </div>

            {choiceNote !== null && (
              <div className="glass glass--card tier-route" role="status" aria-live="polite">
                <p>{choiceNote}</p>
              </div>
            )}

            <div className="plans-meta">
              <p className="plans-fineprint">
                {tiers.route.detail} Taxes may apply.
              </p>
              <FocusButton
                id="plans-compare"
                variant="quiet"
                className="plans-compare-link"
                ariaExpanded={showCompare}
                onSelect={() => setShowCompare((open) => !open)}
              >
                {showCompare ? 'Hide comparison' : 'Compare everything'}
              </FocusButton>
            </div>

            {showCompare && (
              <section className="glass glass--card plans-compare" aria-label="Compare plans">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Feature</th>
                      <th scope="col">Stream</th>
                      <th scope="col">Stream + Live</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE_ROWS.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{row.stream}</td>
                        <td>{row.live}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}

        {/* Far below the plans, and fenced off from them. */}
        <section className="tier-donate">
          <h2>Donate to the app owner</h2>
          <p className="tier-donate__lede">Optional, and it gives you nothing.</p>
          <p className="tier-donate__detail">
            A donation is a gift. It does not create an account, activate one, upgrade one or
            extend one, and nothing in the app changes because you sent it. If you want
            access, contact the owner — do not donate and expect it.
          </p>
          <div className="tier-donate__actions">
            <FocusButton id="donate" className="tvm-button--glass tier-donate__btn" onSelect={() => navigate.push('donate')}>
              Donate
            </FocusButton>
            <FocusButton id="plans-legal" variant="quiet" className="plans-compare-link" onSelect={() => navigate.push('legal')}>
              Privacy &amp; terms
            </FocusButton>
          </div>
        </section>
      </div>
    </main>
  );
}
