import { useCallback, useEffect, useRef, useState } from 'react';
import { BackButton } from '../components/BackButton';
import { FocusButton } from '../components/FocusButton';
import { PageScene } from '../components/PageScene';
import { Ribbon } from '../components/Ribbon';
import {
  fetchServices,
  openServiceExternal,
  setServiceConnected,
  type ConnectedServiceStatus,
} from '../data/services';
import type { ScreenProps } from '../nav/registry';

export function YourServices(_props: ScreenProps): React.JSX.Element {
  const [services, setServices] = useState<ConnectedServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<ConnectedServiceStatus | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pendingRef = useRef<ConnectedServiceStatus | null>(null);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchServices().then((list) => {
      if (!cancelled) {
        setServices(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const checkReturn = (): void => {
      const pending = pendingRef.current;
      if (pending === null) return;
      const popup = popupRef.current;
      if (popup === null || popup.closed || document.visibilityState === 'visible') {
        setConfirming(pending);
      }
    };
    const timer = window.setInterval(() => {
      const popup = popupRef.current;
      if (popup !== null && popup.closed && pendingRef.current !== null) {
        setConfirming(pendingRef.current);
        popupRef.current = null;
      }
    }, 500);
    window.addEventListener('focus', checkReturn);
    document.addEventListener('visibilitychange', checkReturn);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkReturn);
      document.removeEventListener('visibilitychange', checkReturn);
    };
  }, []);

  const beginSignIn = useCallback((svc: ConnectedServiceStatus): void => {
    pendingRef.current = svc;
    setConfirming(svc);
    popupRef.current = openServiceExternal(svc.signin, svc);
  }, []);

  const finishSignIn = useCallback(async (svc: ConnectedServiceStatus, connected: boolean): Promise<void> => {
    pendingRef.current = null;
    setConfirming(null);
    if (!connected) return;
    setBusyId(svc.id);
    try {
      setServices(await setServiceConnected(svc.id, true));
    } finally {
      setBusyId(null);
    }
  }, []);

  const disconnect = useCallback(async (svc: ConnectedServiceStatus): Promise<void> => {
    setBusyId(svc.id);
    try {
      setServices(await setServiceConnected(svc.id, false));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <main className="page page--settings page--docked page--services">
      <PageScene />
      <Ribbon active="apps" />
      <header className="page__toolbar">
        <div className="page__toolbar-lead">
          <BackButton id="services-back" />
          <div>
            <p className="stage__kicker">Services</p>
            <h1 className="page__heading">Your services</h1>
          </div>
        </div>
      </header>
      <p className="page__lede">
        Sign in to your streaming accounts on each service's own page. TVM never sees your passwords.
      </p>

      {confirming !== null && (
        <section className="service-confirm glass glass--sheet glass-appear" role="dialog" aria-label={`Confirm sign in to ${confirming.name}`}>
          <p className="stage__kicker">{confirming.name}</p>
          <h2 className="service-confirm__title">Signed in to {confirming.name}?</h2>
          <p className="page__lede">
            Once connected, Details will offer to look for titles on {confirming.name}.
          </p>
          <div className="hero__actions">
            <FocusButton id="service-confirm-yes" variant="primary" onSelect={() => void finishSignIn(confirming, true)}>
              Yes
            </FocusButton>
            <FocusButton id="service-confirm-no" className="tvm-button--glass" onSelect={() => void finishSignIn(confirming, false)}>
              Not yet
            </FocusButton>
          </div>
        </section>
      )}

      {loading ? (
        <p className="page__lede">Loading services…</p>
      ) : (
        <div className="services-grid" data-wrap="grid" aria-label="Streaming services">
          {services.map((svc, index) => (
            <article key={svc.id} className="service-card glass glass--card">
              <div className="service-card__head">
                <span className="service-card__dot" style={{ backgroundColor: svc.accent }} aria-hidden="true" />
                <div className="service-card__info">
                  <strong className="service-card__name">{svc.name}</strong>
                  <span className={`service-card__status${svc.connected ? ' service-card__status--on' : ''}`}>
                    {svc.connected ? 'Connected' : 'Not signed in'}
                  </span>
                </div>
              </div>
              <div className="service-card__actions" data-wrap="row">
                {svc.connected ? (
                  <>
                    <FocusButton
                      id={index === 0 ? 'service-first' : `service-open-${svc.id}`}
                      variant="primary"
                      disabled={busyId === svc.id}
                      onSelect={() => { openServiceExternal(svc.home, svc); }}
                    >
                      Open
                    </FocusButton>
                    <FocusButton
                      id={`service-disconnect-${svc.id}`}
                      className="tvm-button--glass"
                      disabled={busyId === svc.id}
                      onSelect={() => void disconnect(svc)}
                    >
                      Disconnect
                    </FocusButton>
                  </>
                ) : (
                  <FocusButton
                    id={index === 0 ? 'service-first' : `service-signin-${svc.id}`}
                    className="tvm-button--glass"
                    disabled={busyId === svc.id}
                    onSelect={() => beginSignIn(svc)}
                  >
                    Sign in
                  </FocusButton>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
