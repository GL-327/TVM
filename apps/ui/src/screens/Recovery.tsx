import { FocusButton } from '../components/FocusButton';
import { EmptyState } from '../components/EmptyState';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function Recovery(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <main className="page page--recovery">
      <EmptyState
        eyebrow="Recovery"
        title="TVM restarted in safe mode"
        body="The interface stopped three times in one minute. Review settings or return to Home. Network providers will only be contacted when a screen requests them."
        actions={
          <>
            <FocusButton id="settings" variant="primary" onSelect={() => navigate.push('settings')}>
              Settings
            </FocusButton>
            <FocusButton
              id="home"
              onSelect={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete('recovery');
                window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
                navigate.reset('home');
              }}
            >
              Return to Home
            </FocusButton>
            <FocusButton
              id="shutdown"
              onSelect={() =>
                navigate.pushModal('confirm', {
                  params: {
                    title: 'Close TVM?',
                    body: 'On this PC the window closes. On an appliance this will become a real shutdown.',
                    confirmLabel: 'Close',
                    action: 'shutdown',
                  },
                })
              }
            >
              Shutdown
            </FocusButton>
          </>
        }
      />
    </main>
  );
}
