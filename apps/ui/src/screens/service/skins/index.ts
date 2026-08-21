import { lazy, type ComponentType } from 'react';
import type { ServiceSkinProps } from './types';

const NetflixHub = lazy(() =>
  import('./netflix').then((module) => ({ default: module.NetflixHub as ComponentType<ServiceSkinProps> })),
);
const PrimeHub = lazy(() =>
  import('./prime').then((module) => ({ default: module.PrimeHub as ComponentType<ServiceSkinProps> })),
);
const MaxHub = lazy(() =>
  import('./max').then((module) => ({ default: module.MaxHub as ComponentType<ServiceSkinProps> })),
);
const DisneyHub = lazy(() =>
  import('./disney').then((module) => ({ default: module.DisneyHub as ComponentType<ServiceSkinProps> })),
);
const AppleTvHub = lazy(() =>
  import('./appletv').then((module) => ({ default: module.AppleTvHub as ComponentType<ServiceSkinProps> })),
);
const HuluHub = lazy(() =>
  import('./hulu').then((module) => ({ default: module.HuluHub as ComponentType<ServiceSkinProps> })),
);
const PeacockHub = lazy(() =>
  import('./peacock').then((module) => ({ default: module.PeacockHub as ComponentType<ServiceSkinProps> })),
);
const LegacyHub = lazy(() =>
  import('./legacy').then((module) => ({ default: module.LegacyHub })),
);

const SKINS: Record<string, ComponentType<ServiceSkinProps>> = {
  netflix: NetflixHub,
  prime: PrimeHub,
  max: MaxHub,
  disney: DisneyHub,
  appletv: AppleTvHub,
  hulu: HuluHub,
  peacock: PeacockHub,
};

/** Classes revealFocused treats as the hub camera scroller. */
const CAMERA_ROOT = /\b(home|page|details|service|prime-hub|dplus-hub|max-hub)\b/;

/** Inner loop hosts. Service patches `data-wrap` only when a skin omits it. */
export const HUB_WRAP_HOSTS = [
  'nav',
  '.rail__track',
  '.service-nav',
  '.service-nav__tabs',
  '.service-hero__actions',
  '[class*="__tabs"]',
  '[class*="__actions"]',
  '[class*="-brands"]',
  '[class*="-chips"]',
].join(', ');

export function resolveServiceSkin(layoutOrId: string): ComponentType<ServiceSkinProps> {
  return SKINS[layoutOrId] ?? LegacyHub;
}

export function resolveHubRoot(host: HTMLElement): HTMLElement {
  const direct = host.querySelector<HTMLElement>(
    ':scope > main, :scope > .service, :scope > .page, :scope > [class*="-hub"]',
  );
  if (direct !== null) return direct;
  return host.querySelector<HTMLElement>('main, .service, .page, [class*="-hub"]') ?? host;
}

function wrapValue(el: HTMLElement): string {
  const cls = el.className;
  if (typeof cls === 'string' && (cls.includes('prime-hub__nav') || cls.includes('hulu-hub__nav'))) return 'col';
  return 'row';
}

/** Fill camera class + data-wrap when a lazy skin's root omitted them. Idempotent. */
export function ensureHubRootAttrs(host: HTMLElement): void {
  const root = resolveHubRoot(host);
  if (!CAMERA_ROOT.test(root.className)) root.classList.add('service');
  for (const el of root.querySelectorAll<HTMLElement>(HUB_WRAP_HOSTS)) {
    if (!el.hasAttribute('data-wrap')) el.setAttribute('data-wrap', wrapValue(el));
  }
  if (!root.hasAttribute('data-wrap')) root.setAttribute('data-wrap', 'y');
}

export type { HubCatalog, ServiceSkinProps } from './types';
export { LegacyHub };
