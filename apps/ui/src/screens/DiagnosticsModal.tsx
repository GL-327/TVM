import { FocusButton } from '../components/FocusButton';
import { useNavigate } from '../nav/ViewStackContext';
import { useCoreHealth } from '../useCoreHealth';
import type { ScreenProps } from '../nav/registry';

export function DiagnosticsModal(_props: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const health = useCoreHealth();

  const rows: Array<[string, string]> = [
    ['Interface', `v${__TVM_UI_VERSION__}`],
    ['Core', health.status === 'online' ? `v${health.version ?? 'unknown'}` : health.status],
    ['Display', `${window.screen.width} × ${window.screen.height}`],
    ['Viewport', `${window.innerWidth} × ${window.innerHeight}`],
    ['Pixel ratio', String(window.devicePixelRatio)],
  ];

  return (
    <div className="panel-scrim" role="dialog" aria-modal="true" aria-label="System information">
      <section className="panel">
        <h2 className="panel__title">System information</h2>
        <dl className="panel__rows">
          {rows.map(([label, value]) => (
            <div className="panel__row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <FocusButton id="close" variant="primary" onSelect={() => navigate.pop()}>
          Close
        </FocusButton>
      </section>
    </div>
  );
}
