import { useCallback, useEffect, useState } from 'react';
import { AnimeStage } from './theme/anime/AnimeStage';
import { SceneField } from './theme/SceneField';
import { SynthwaveCrt } from './theme/SynthwaveCrt';
import { ViewStackProvider } from './nav/ViewStackProvider';
import { AccountGate } from './screens/AccountGate';
import { fetchAccount, readToken, SIGNED_OUT, type AccountState } from './data/account';
import { applyPlanClass, fetchPlan } from './data/plan';
import { applyGithubUpdateOnLaunch } from './data/launchUpdate';

/**
 * The app, behind its door.
 *
 * The gate is not a screen in the view stack — it is rendered instead of the
 * stack, so there is no route, no back gesture and no deep link that reaches
 * the catalogue without a usable account. That matters more than it sounds:
 * TVM plays from sources the operator is responsible for, so "who is this" has
 * to be answered before anything else renders, not guarded screen by screen.
 *
 * The server enforces the same rule on every request; this is the part that
 * stops the interface flashing a library nobody is entitled to see.
 */
export function App(): React.JSX.Element {
  // `undefined` means "not asked yet", which is different from signed out and
  // must not paint the gate: on a returning device that would flash the sign-in
  // form for a frame before the account resolves.
  const [account, setAccount] = useState<AccountState | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    const next = readToken() === null ? SIGNED_OUT : await fetchAccount();
    setAccount(next);
    if (next.usable.ok) {
      // The server applies the account's tier to the plan engine when it
      // answers /api/account, so the styling can only be correct after it has.
      applyPlanClass(await fetchPlan(undefined, true));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  // Behind the door as well: a fresh install must still be able to pull a
  // new interface before anyone has signed in, which is how iOS auto-update
  // is tested. ViewStack used to start this, and that never mounts here.
  useEffect(() => { void applyGithubUpdateOnLaunch(); }, []);

  const onChanged = useCallback((next: AccountState): void => {
    setAccount(next);
    if (next.usable.ok) void fetchPlan(undefined, true).then(applyPlanClass).catch(() => undefined);
  }, []);

  if (account === undefined) return <div className="app-boot" aria-busy="true" />;

  if (!account.usable.ok) {
    return (
      <>
        <SceneField />
        <AccountGate state={account} onChanged={onChanged} />
      </>
    );
  }

  return (
    <>
      {/* Both stages sit behind the screen stack: `.tvm-scene` and `.rt-set`
          are z-index 0, `.app__screen` is z-index 1. Retro hides the scene and
          paints its own television set instead. */}
      <SceneField />
      <SynthwaveCrt />
      <AnimeStage />
      <ViewStackProvider />
    </>
  );
}
