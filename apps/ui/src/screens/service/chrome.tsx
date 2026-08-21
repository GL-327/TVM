import { memo, useCallback, useRef, type ReactNode } from 'react';
import { BrandMark, hasBrandMark } from '../../components/BrandMark';
import { FocusButton } from '../../components/FocusButton';
import type { AppHubPayload } from '../../data/apps';
import { navTabs, type Lane } from './layouts';
import './chrome.css';

export type { Lane } from './layouts';
export { moreLabel, navTabs, playLabel } from './layouts';

/** Stable across hub re-fetches and lane changes. Never include catalog ids. */
export const SERVICE_BACK_ID = 'service-back';
export const SERVICE_PLAY_ID = 'service-play';
export const SERVICE_INFO_ID = 'service-info';

/** Shared category row. Skins may keep `.rail`; TVM cameras either host. */
export const SERVICE_RAIL_CLASS = 'service-rail';
export const SERVICE_RAIL_SELECTOR = '.service-rail, .rail';

/**
 * Hero action rows. Down from these must land on the next rail so the
 * page camera can reveal it. Brand files keep their own class names.
 */
export const SERVICE_HERO_ROW_SELECTOR = [
  '.service-hero__actions',
  '.prime-hub__actions',
  '.dplus-hero__actions',
  '.max-hero__actions',
  '.hulu-hub__actions',
  '.appletv-hub__actions',
  '.peacock-hub__actions',
  '.legacy-hub__actions',
  '.nf-hub__actions',
].join(', ');

const tabsByLayout = new Map<string, ReturnType<typeof navTabs>>();
const tabSelectCache = new Map<Lane, () => void>();
const onLaneSink: { current: (lane: Lane) => void } = { current: () => undefined };

export function serviceTabId(lane: string): string {
  return `service-tab-${lane}`;
}

export function chromeTabs(layout: string): ReturnType<typeof navTabs> {
  const hit = tabsByLayout.get(layout);
  if (hit !== undefined) return hit;
  const tabs = navTabs(layout);
  tabsByLayout.set(layout, tabs);
  return tabs;
}

/** Prime chrome is a sidebar; every other hub is a top row. */
export function chromeWrap(layout: string): 'row' | 'col' {
  return layout === 'prime' ? 'col' : 'row';
}

export function serviceNavFocusIds(layout: string): string[] {
  return [SERVICE_BACK_ID, ...chromeTabs(layout).map((tab) => serviceTabId(tab.id))];
}

function dispatchLane(lane: Lane): void {
  onLaneSink.current(lane);
}

function tabHandler(lane: Lane): () => void {
  const hit = tabSelectCache.get(lane);
  if (hit !== undefined) return hit;
  const next = (): void => {
    dispatchLane(lane);
  };
  tabSelectCache.set(lane, next);
  return next;
}

const TabButton = memo(function TabButton({
  id,
  label,
  on,
  onSelect,
}: {
  id: string;
  label: string;
  on: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <FocusButton id={id} className={`service-nav__tab${on ? ' service-nav__tab--on' : ''}`} onSelect={onSelect}>
      {label}
    </FocusButton>
  );
});

const BackButton = memo(function BackButton({ onSelect }: { onSelect: () => void }): React.JSX.Element {
  return (
    <FocusButton id={SERVICE_BACK_ID} className="service-nav__back" onSelect={onSelect}>
      Back
    </FocusButton>
  );
});

const Brand = memo(function Brand({
  id,
  name,
  wordmark,
}: {
  id: string;
  name: string;
  wordmark: string;
}): React.JSX.Element {
  return (
    <div className={`service-nav__brand service-nav__brand--${id}`}>
      {hasBrandMark(id) ? <BrandMark id={id} /> : <span>{wordmark || name}</span>}
    </div>
  );
});

function Tabs({ layout, lane }: { layout: string; lane: Lane }): React.JSX.Element {
  const wrap = chromeWrap(layout);
  return (
    <div className="service-nav__tabs" data-wrap={wrap}>
      {chromeTabs(layout).map((tab) => (
        <TabButton
          key={tab.id}
          id={serviceTabId(tab.id)}
          label={tab.label}
          on={lane === tab.id}
          onSelect={tabHandler(tab.id)}
        />
      ))}
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
  const wrap = chromeWrap(layout);
  onLaneSink.current = onLane;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const selectBack = useCallback(() => {
    onBackRef.current();
  }, []);

  return (
    <nav className={`service-nav service-chrome service-nav--${layout}`} aria-label={hub.name} data-wrap={wrap}>
      <BackButton onSelect={selectBack} />
      <Brand id={hub.id} name={hub.name} wordmark={hub.wordmark} />
      <Tabs layout={layout} lane={lane} />
    </nav>
  );
}

export const ServiceShell = memo(function ServiceShell({
  layout,
  children,
}: {
  layout: string;
  children: ReactNode;
}): React.JSX.Element {
  return <main className={`service service-chrome-shell service--${layout}`}>{children}</main>;
});
