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

function ServiceEmbed({ id, url, name }: { id: string; url: string; name: string }): React.JSX.Element {
  const navigate = useNavigate();
  const [message, setMessage] = useState(`Opening ${name} in this window…`);

  useEffect(() => {
    if (!url.startsWith('https://')) {
      setMessage('This service is not available as an embedded site.');
      return;
    }
    const bridge = window.tvmServiceBrowser;
    if (bridge === undefined) {
      setMessage(
        `${name} is not an in-window site on this computer. Use Back, then open it from Apps as a TVM catalog, or use the television’s own app.`,
      );
      return;
    }
    let cancelled = false;
    void bridge
      .start({ id: id === '' ? name.toLowerCase() : id, url, title: name })
      .then(() => {
        if (!cancelled) setMessage(`${name} stays in this window. Back or Home returns to TVM.`);
      })
      .catch(() => {
        if (!cancelled) setMessage(`${name} could not be opened in this window.`);
      });
    const stop = bridge.onEvent((event) => {
      if (event.type === 'closed') navigate.pop();
    });
    return () => {
      cancelled = true;
      stop();
      void bridge.stop();
    };
  }, [id, name, navigate, url]);

  return (
    <main className="page page--library service-fallback">
      <EmptyState
        eyebrow={name}
        title={name}
        body={message}
        actions={
          <FocusButton id="close" variant="primary" onSelect={() => navigate.pop()}>
            Back
          </FocusButton>
        }
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

  return <ServiceEmbed id={id} url={url} name={name} />;
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
