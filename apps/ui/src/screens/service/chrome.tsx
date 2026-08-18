import type { ReactNode } from 'react';
import { FocusButton } from '../../components/FocusButton';
import type { AppHubPayload } from '../../data/apps';
import { navTabs, type Lane } from './layouts';

export type { Lane } from './layouts';
export { moreLabel, navTabs, playLabel } from './layouts';

function Tabs({
  layout,
  lane,
  onLane,
}: {
  layout: string;
  lane: Lane;
  onLane: (lane: Lane) => void;
}): React.JSX.Element {
  return (
    <div className="service-nav__tabs">
      {navTabs(layout).map((tab) => (
        <FocusButton
          key={tab.id}
          id={`service-tab-${tab.id}`}
          className={`service-nav__tab${lane === tab.id ? ' service-nav__tab--on' : ''}`}
          onSelect={() => onLane(tab.id)}
          onFocus={() => onLane(tab.id)}
        >
          {tab.label}
        </FocusButton>
      ))}
    </div>
  );
}

function Brand({ hub }: { hub: AppHubPayload }): React.JSX.Element {
  return (
    <div className="service-nav__brand">
      {hub.logo !== '' ? <img src={hub.logo} alt="" className="service-nav__logo" /> : null}
      <span>{hub.wordmark || hub.name}</span>
    </div>
  );
}

export function ServiceNav({
  hub,
  lane,
  onLane,
  onBack,
}: {
  hub: AppHubPayload;
  lane: Lane;
  onLane: (lane: Lane) => void;
  onBack: () => void;
}): React.JSX.Element {
  const layout = hub.layout;

  return (
    <nav className={`service-nav service-nav--${layout}`} aria-label={hub.name}>
      <FocusButton id="service-back" className="service-nav__back" onSelect={onBack}>
        Back
      </FocusButton>
      <Brand hub={hub} />
      <Tabs layout={layout} lane={lane} onLane={onLane} />
    </nav>
  );
}

export function ServiceShell({
  layout,
  children,
}: {
  layout: string;
  children: ReactNode;
}): React.JSX.Element {
  return <main className={`service service--${layout}`}>{children}</main>;
}
