import { useEffect, useRef } from 'react';
import type { CoreHealth } from './useCoreHealth';

interface DiagnosticsProps {
  health: CoreHealth;
  onClose: () => void;
}

/**
 * The panel used to verify a boot on real hardware: it answers "did the
 * display negotiate the mode we expected, and can this box reach core".
 */
export function Diagnostics({ health, onClose }: DiagnosticsProps): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const rows: Array<[string, string]> = [
    ['Interface', `v${__TVM_UI_VERSION__}`],
    ['Core', health.status === 'online' ? `v${health.version ?? 'unknown'}` : health.status],
    ['Display', `${window.screen.width} x ${window.screen.height}`],
    ['Viewport', `${window.innerWidth} x ${window.innerHeight}`],
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

        <button ref={closeRef} type="button" className="tvm-button tvm-button--primary" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}
