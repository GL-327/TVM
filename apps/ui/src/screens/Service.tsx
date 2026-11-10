import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EmptyState } from '../components/EmptyState';
import { FocusButton } from '../components/FocusButton';
import { LoadingScreen } from '../components/LoadingScreen';
import { fetchAppHub, isHubApp, isMockApp, peekAppHub, type AppHubPayload } from '../data/apps';
import { APPS, MORE_APPS } from '../data/catalog';
import { openPlayback } from '../data/openDetails';
import { applyPlanClass, fetchPlan } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { ensureHubRootAttrs, resolveServiceSkin } from './service/skins';
import './service.css';

function ServiceLink({ url, name }: { url: string; name: string }): React.JSX.Element {
  const navigate = useNavigate();
  const available = url.startsWith('https://');
  return (
    <main className="page page--library service-fallback">
      <EmptyState eyebrow={name} title={name}
        body="Open the provider's website in your browser. Use your own subscription to sign in."
        actions={<>
          {available && <a className="btn btn--primary" href={url} target="_blank" rel="noopener noreferrer">Open {name}</a>}
          <FocusButton id="close" onSelect={() => navigate.pop()}>Back</FocusButton>
        </>}
      />
    </main>
  );
}

export function Service({ params }: ScreenProps): React.JSX.Element {
  const id = typeof params['id'] === 'string' ? params['id'] : '';
  const requested = typeof params['url'] === 'string' ? params['url'] : '';
  const named = typeof params['title'] === 'string' ? params['title'] : '';
  const app = [...APPS, ...MORE_APPS].find((entry) => entry.id === id);
  const url = requested.startsWith('https://') ? requested : (app?.url ?? '');
  const name = named !== '' ? named : (app?.name ?? 'Page');

  useEffect(() => {
    void fetchPlan().then(applyPlanClass);
  }, []);

  if (isMockApp(id) || isHubApp(id) || url === 'internal:mock' || url === '') {
    return <ServiceHubScreen appId={id === '' ? 'netflix' : id} name={name} />;
  }

  return <ServiceLink url={url} name={name} />;
}

function ServiceHubFallback({ name }: { name: string }): React.JSX.Element {
  return (
    <main className="page page--library">
      <LoadingScreen eyebrow={name} title={`Opening ${name}…`} body="Loading this mock hub from the local catalog." />
    </main>
  );
}

function ServiceHubScreen({ appId, name }: { appId: string; name: string }): React.JSX.Element {
  const navigate = useNavigate();
  const [hub, setHub] = useState<AppHubPayload | null>(() => peekAppHub(appId));

  useEffect(() => {
    let cancelled = false;
    const cached = peekAppHub(appId);
    if (cached !== null) {
      setHub(cached);
      return;
    }
    void fetchAppHub(appId).then((payload) => {
      if (!cancelled) setHub(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (hub === null) {
    return <ServiceHubFallback name={name} />;
  }

  const Skin = resolveServiceSkin(hub.layout || appId);
  return (
    <Suspense fallback={<ServiceHubFallback name={name} />}>
      <HubHost key={appId}>
        <Skin
          appId={appId}
          hub={hub}
          catalog={{
            rails: hub.rails,
            continueWatching: hub.continueWatching,
            hero: hub.hero,
          }}
          navigate={navigate}
          play={(title) => openPlayback(navigate, title)}
        />
      </HubHost>
    </Suspense>
  );
}

/** display:contents so this is not a second camera scroller. Patches data-wrap if the skin root omitted it. */
function HubHost({ children }: { children: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = ref.current;
    if (host === null) return;
    ensureHubRootAttrs(host);
    let frame = 0;
    const mo = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        ensureHubRootAttrs(host);
      });
    });
    mo.observe(host, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
