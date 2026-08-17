import { FocusButton } from '../components/FocusButton';
import { enterTvmStream } from '../data/profiles';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

export function NoticeModal({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const title = typeof params['title'] === 'string' ? params['title'] : 'Notice';
  const body = typeof params['body'] === 'string' ? params['body'] : '';
  const action = typeof params['action'] === 'string' ? params['action'] : '';

  const close = (): void => {
    navigate.pop();
  };

  const openTvmStream = (): void => {
    navigate.pop();
    void enterTvmStream(navigate);
  };

  return (
    <div className="panel-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <section className="panel">
        <h2 className="panel__title">{title}</h2>
        <p className="page__lede">{body}</p>
        {action === 'tvm-stream' ? (
          <div className="hero__actions">
            <FocusButton id="close" variant="primary" onSelect={openTvmStream}>
              Open TVM Stream
            </FocusButton>
            <FocusButton id="dismiss" onSelect={close}>
              Close
            </FocusButton>
          </div>
        ) : (
          <FocusButton id="close" variant="primary" onSelect={close}>
            Close
          </FocusButton>
        )}
      </section>
    </div>
  );
}
