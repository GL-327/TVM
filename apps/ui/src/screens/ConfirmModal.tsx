import { FocusButton } from '../components/FocusButton';
import { clearCache, factoryReset, requestSession } from '../data/media';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function ConfirmModal({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const title = typeof params['title'] === 'string' ? params['title'] : 'Confirm';
  const body = typeof params['body'] === 'string' ? params['body'] : '';
  const confirmLabel = typeof params['confirmLabel'] === 'string' ? params['confirmLabel'] : 'OK';
  const action = typeof params['action'] === 'string' ? params['action'] : 'cancel';

  const confirm = (): void => {
    if (action === 'restart') {
      window.location.reload();
      return;
    }
    if (action === 'shutdown') {
      window.close();
      return;
    }
    if (action === 'clear-cache') {
      void clearCache().then(() => navigate.pop());
      return;
    }
    if (action === 'factory-reset') {
      void factoryReset().then(() => {
        window.location.reload();
      });
      return;
    }
    if (action === 'linux-desktop') {
      void requestSession('desktop').then((result) => {
        if (result.ok) return;
        navigate.pop();
        navigate.pushModal('notice', {
          params: {
            title: 'Linux desktop',
            body:
              result.reason === 'not_appliance'
                ? 'The Linux desktop is only on the TVM USB stick, where TVM boots fullscreen by itself.'
                : 'TVM could not leave the kiosk.',
          },
        });
      });
      return;
    }
    navigate.pop();
  };

  return (
    <div className="panel-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <section className="panel">
        <h2 className="panel__title">{title}</h2>
        <p className="page__lede">{body}</p>
        <div className="hero__actions">
          <FocusButton id="confirm" variant="primary" onSelect={confirm}>
            {confirmLabel}
          </FocusButton>
          <FocusButton id="cancel" onSelect={() => navigate.pop()}>
            Cancel
          </FocusButton>
        </div>
      </section>
    </div>
  );
}
