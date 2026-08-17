import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { FocusButton } from '../components/FocusButton';
import { isMockApp } from '../data/apps';
import { APPS, MORE_APPS } from '../data/catalog';
import { applyPlanClass, fetchPlan } from '../data/plan';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';
import { ServiceHome } from './service/ServiceHome';
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
      setMessage('This service opens as a TVM catalog on this device.');
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
  const [allowed, setAllowed] = useState(!isMockApp(id));
  const [checked, setChecked] = useState(!isMockApp(id));
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMockApp(id)) return;
    void fetchPlan().then((plan) => {
      applyPlanClass(plan);
      setAllowed(plan.mocks);
      setChecked(true);
    });
  }, [id]);

  if (isMockApp(id) && checked && !allowed) {
    return (
      <main className="page page--library">
        <EmptyState
          eyebrow={name}
          title={`${name} is on Ultra and MAX`}
          body="Mock streaming hubs are a TVM Ultra and TVM MAX extra. TVM Stream still plays your library."
          actions={
            <>
              <FocusButton id="service-upgrade" variant="primary" onSelect={() => navigate.push('plans')}>
                View plans
              </FocusButton>
              <FocusButton id="close" onSelect={() => navigate.pop()}>
                Back
              </FocusButton>
            </>
          }
        />
      </main>
    );
  }

  if (isMockApp(id) || url === 'internal:mock' || url === '') {
    return <ServiceHome appId={id === '' ? 'netflix' : id} />;
  }

  return <ServiceEmbed id={id} url={url} name={name} />;
}
