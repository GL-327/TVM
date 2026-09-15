import { useEffect, useState } from 'react';
import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { fetchAccount, fetchTiers, type AccountState, type TiersResponse } from '../data/account';
import { formatBillingMoney } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import './plans.css';

/**
 * What access costs, and how to get it.
 *
 * This used to be a shop: five tiers, a card form, a checkout. None of that
 * exists now — nothing is sold inside the app and there is no route from here
 * to a payment for access. The page answers two questions instead. What does
 * it cost, and who do I ask.
 *
 * The donate button sits at the bottom deliberately, well below the prices and
 * clearly separated, so it can never read as the way to pay for a plan. It
 * says three times over that it gives you nothing, because the one thing that
 * must not happen is somebody donating in the belief it will switch them on.
 */

function tierCard(
  tier: TiersResponse['tiers'][number],
  current: AccountState,
): React.JSX.Element {
  const mine = current.account?.tier === tier.id && current.account.activated;
  return (
    <section key={tier.id} className={`tier-card${mine ? ' tier-card--mine' : ''}`}>
      <header className="tier-card__head">
        <div>
          <h2 className="tier-card__name">{tier.name}</h2>
          <p className="tier-card__summary">{tier.summary}</p>
        </div>
        {tier.monthlyPence !== null && (
          <p className="tier-card__price">
            {formatBillingMoney(tier.monthlyPence)}<span>/month</span>
          </p>
        )}
      </header>

      {mine && <p className="tier-card__mine">This is your access</p>}

      <ul className="tier-card__list">
        {tier.includes.map((line) => <li key={line}>{line}</li>)}
      </ul>

      {tier.liveTvTerms.length > 0 && (
        <div className="tier-card__terms">
          <h3>Live TV is priced separately</h3>
          <ul>
            {tier.liveTvTerms.map((term) => (
              <li key={term.id}>
                <span>{term.name}</span>
                <span className="tier-card__term-price">{formatBillingMoney(term.amountPence)}</span>
                <span className="tier-card__term-note">{term.blurb}</span>
              </li>
            ))}
          </ul>
          <p className="tier-card__fineprint">
            Live TV connects an IPTV subscription you supply and hold yourself. TVM does not
            include one, and supplies no channels.
          </p>
        </div>
      )}
    </section>
  );
}

export function Plans(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const [tiers, setTiers] = useState<TiersResponse | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchTiers().then((list) => { if (!cancelled) setTiers(list); });
    void fetchAccount().then((state) => { if (!cancelled) setAccount(state); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="page page--settings page--plans">
      <TopBar title="Access" />
      <p className="stage__kicker">Access</p>
      <h1 className="page__heading">What TVM costs</h1>
      <p className="page__lede">
        Two kinds of access, arranged directly with the app owner. There is nothing to buy
        in the app and no card is taken here.
      </p>

      {account?.account != null && (
        <section className="tier-current">
          <p className="plan-current__kicker">Your account</p>
          <h2>{account.account.email}</h2>
          <p>
            {account.account.activated
              ? `Active · ${account.account.tier === 'stream-live' ? 'Movies, TV shows and Live TV' : 'Movies and TV shows'}`
              : 'Waiting to be switched on by the app owner'}
          </p>
        </section>
      )}

      {tiers === null ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          <div className="tier-grid">{tiers.tiers.map((tier) => tierCard(tier, account ?? { signedIn: false, account: null, usable: { ok: false, reason: null }, termsVersion: '' }))}</div>

          <section className="tier-route">
            <h2>{tiers.route.headline}</h2>
            <p>{tiers.route.detail}</p>
          </section>
        </>
      )}

      {/* Far below the prices, and fenced off from them. */}
      <section className="tier-donate">
        <h2>Donate to the app owner</h2>
        <p className="tier-donate__lede">Optional, and it gives you nothing.</p>
        <p className="tier-donate__detail">
          A donation is a gift. It does not create an account, activate one, upgrade one or
          extend one, and nothing in the app changes because you sent it. If you want
          access, contact the owner — do not donate and expect it.
        </p>
        <div className="hero__actions">
          <FocusButton id="donate" onSelect={() => navigate.push('donate')}>
            Donate
          </FocusButton>
          <FocusButton id="plans-legal" onSelect={() => navigate.push('legal')}>
            Terms &amp; privacy
          </FocusButton>
        </div>
      </section>
    </main>
  );
}
