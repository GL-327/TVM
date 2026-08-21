import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect, useRef } from 'react';
import { prefetchAppHub } from '../data/apps';
import type { AppTile } from '../data/catalog';
import { requestFocus } from '../nav/focusEngine';
import { focusKeyFor } from '../nav/railNav';
import { revealFocused, scrollAxis, shouldNudgePageY } from '../nav/revealFocused';
import { useFocusScope, useScopedFocusKey } from '../nav/ViewStackContext';
import { appGridCameraY, pickGridNeighborIndex } from './appGridNav';
import { BrandMark, hasBrandMark } from './BrandMark';

interface AppCardProps {
  app: AppTile;
  id: string;
  onSelect: () => void;
  size?: 'ribbon' | 'grid';
  locked?: boolean;
}

function gridTiles(card: HTMLElement): HTMLElement[] {
  const grid = card.closest<HTMLElement>('.app-grid');
  if (grid === null) return [];
  return [...grid.querySelectorAll<HTMLElement>('[data-focus-id]:not([data-loop-clone="true"])')];
}

function hopGridNeighbor(card: HTMLElement, direction: 'up' | 'down'): HTMLElement | null {
  const items = gridTiles(card);
  const index = items.indexOf(card);
  if (index < 0) return null;
  const boxes = items.map((item) => item.getBoundingClientRect());
  const next = pickGridNeighborIndex(
    boxes.map((box) => box.top),
    boxes.map((box) => box.left + box.width / 2),
    index,
    direction,
  );
  return next === null ? null : (items[next] ?? null);
}

function cameraAppGrid(card: HTMLElement): void {
  const items = gridTiles(card);
  const scroller = card.closest<HTMLElement>('.page');
  if (items.length === 0 || scroller === null) return;
  const first = items[0];
  if (first === undefined) return;
  const view = scroller.getBoundingClientRect();
  const target = appGridCameraY(
    scroller.scrollTop,
    view.top,
    card.getBoundingClientRect().top,
    first.getBoundingClientRect().top,
  );
  if (shouldNudgePageY(scroller.scrollTop, target)) scrollAxis(scroller, 'y', target);
}

function focusGridNeighbor(card: HTMLElement, direction: 'up' | 'down', scope: string): boolean {
  const next = hopGridNeighbor(card, direction);
  if (next === null) return false;
  const key = focusKeyFor(next) ?? `${scope}/${next.getAttribute('data-focus-id') ?? ''}`;
  if (key.endsWith('/')) return false;
  requestFocus(key);
  return true;
}

export function AppCard({ app, id, onSelect, size = 'ribbon', locked = false }: AppCardProps): React.JSX.Element {
  const scope = useFocusScope();
  const focusKey = useScopedFocusKey(id);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: true,
    onArrowPress: (direction): boolean => {
      if (size !== 'grid' || (direction !== 'down' && direction !== 'up')) return true;
      const node = cardRef.current;
      if (node === null) return true;
      return !focusGridNeighbor(node, direction, scope);
    },
    onFocus: () => {
      prefetchAppHub(app.id);
      const node = cardRef.current;
      if (node === null) return;
      requestAnimationFrame(() => {
        if (size === 'grid') cameraAppGrid(node);
        else revealFocused(node);
      });
    },
  });

  useEffect(() => {
    if (size !== 'grid') return undefined;
    const node = cardRef.current;
    if (node === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const direction = event.key === 'ArrowDown' ? 'down' : 'up';
      if (!focusGridNeighbor(node, direction, scope)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    node.addEventListener('keydown', onKey, true);
    return () => node.removeEventListener('keydown', onKey, true);
  }, [size, scope]);

  return (
    <button
      ref={(node) => {
        cardRef.current = node;
        const focusRef = ref as { current: HTMLButtonElement | null } & ((el: HTMLButtonElement | null) => void);
        if (typeof ref === 'function') focusRef(node);
        else focusRef.current = node;
      }}
      type="button"
      className={`app-card app-card--${size} app-card--${app.id}${locked ? ' app-card--locked' : ''}`}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-app-id={app.id}
      aria-label={locked ? `${app.name}, upgrade to open` : app.name}
      onClick={onSelect}
    >
      <span className="app-card__art" style={{ background: app.accent }}>
        {app.icon !== undefined && app.icon !== '' ? (
          <img className="app-card__icon" src={app.icon} alt="" decoding="async" referrerPolicy="no-referrer" />
        ) : hasBrandMark(app.id) ? (
          <BrandMark id={app.id} />
        ) : (
          <span className="app-card__wordmark">{app.wordmark ?? app.name}</span>
        )}
        {size === 'grid' && <span className="app-card__name">{app.name}</span>}
        {locked ? <span className="app-card__lock">Upgrade</span> : null}
      </span>
    </button>
  );
}
