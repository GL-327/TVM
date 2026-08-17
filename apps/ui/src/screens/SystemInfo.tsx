import { FocusButton } from '../components/FocusButton';
import { TopBar } from '../components/TopBar';
import { useNavigate } from '../nav/ViewStackContext';
import type { ScreenProps } from '../nav/registry';

interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

type NavigatorWithConnection = Navigator & { connection?: NetworkInformation };

export function SystemInfo({ params }: ScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const section = params['section'] === 'network' ? 'network' : 'display';
  const connection = (navigator as NavigatorWithConnection).connection;
  const rows: Array<[string, string]> =
    section === 'network'
      ? [
          ['Status', navigator.onLine ? 'Connected' : 'Offline'],
          ['Connection', connection?.effectiveType?.toUpperCase() ?? 'Managed by the operating system'],
          ['Estimated speed', connection?.downlink === undefined ? 'Unavailable' : `${connection.downlink} Mb/s`],
          ['Estimated latency', connection?.rtt === undefined ? 'Unavailable' : `${connection.rtt} ms`],
        ]
      : [
          ['Panel', `${window.screen.width} × ${window.screen.height}`],
          ['TVM viewport', `${window.innerWidth} × ${window.innerHeight}`],
          ['Pixel ratio', String(window.devicePixelRatio)],
          ['Colour depth', `${window.screen.colorDepth}-bit`],
          ['Mode', document.fullscreenElement === null ? 'Window / shell controlled' : 'Fullscreen'],
        ];

  return (
    <main className="page page--settings">
      <TopBar title={section === 'network' ? 'Network' : 'Display'} />
      <p className="stage__kicker">Device status</p>
      <h1 className="page__heading">{section === 'network' ? 'Network' : 'Display'}</h1>
      <p className="page__lede">
        {section === 'network'
          ? 'TVM reports the active connection. Wi-Fi selection is handled by the appliance setup layer, not a fake web control.'
          : 'These are the values TVM is actually rendering. Overscan and HDMI mode are controlled by the appliance and television.'}
      </p>
      <dl className="panel__rows settings-summary">
        {rows.map(([label, value]) => (
          <div className="panel__row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <FocusButton id="back" variant="primary" onSelect={() => navigate.pop()}>
        Back
      </FocusButton>
    </main>
  );
}
