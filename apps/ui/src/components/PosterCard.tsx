import { memo, useCallback, useEffect, useRef, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import type { Title } from '../data/catalog';
import { prefetchDetails } from '../data/openDetails';
import { revealFocused } from '../nav/revealFocused';
import { useScopedFocusKey } from '../nav/ViewStackContext';
import { Artwork } from './Artwork';
import { LoopClone } from './LoopClone';
import { QualityBadges } from './QualityBadges';

interface PosterCardProps {
  title: Title;
  onSelect: (title: Title) => void;
  prefix: string;
  layout?: 'portrait' | 'landscape';
  index?: number;
  total?: number;
  firstId?: string;
  lastId?: string;
  loopCopy?: number;
}

function posterFocusId(prefix: string, titleId: string, index: number, loopCopy: number): string {
  const base = `${prefix}-${titleId}-${index}`;
  return loopCopy !== 1 ? `${base}--${loopCopy}` : base;
}

function useDetailsPrefetch({ id, kind }: Title, focused = false) {
  const pointerTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(pointerTimer.current), [id, kind]);
  useEffect(() => {
    if (!focused) return;
    const timer = window.setTimeout(() => prefetchDetails(id, kind), 150);
    return () => window.clearTimeout(timer);
  }, [focused, id, kind]);
  return {
    onPointerEnter: (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      window.clearTimeout(pointerTimer.current);
      pointerTimer.current = window.setTimeout(() => prefetchDetails(id, kind), 150);
    },
    onPointerLeave: (): void => window.clearTimeout(pointerTimer.current),
  };
}

const PosterFace = memo(function PosterFace({
  title,
  layout,
  decorative,
}: {
  title: Title;
  layout: 'portrait' | 'landscape';
  decorative: boolean;
}): ReactNode {
  const progress = title.progress;
  return (
    <>
      <Artwork
        title={title}
        kind={layout === 'landscape' ? 'backdrop' : 'poster'}
        className="poster__art"
        decorative={decorative}
      />
      {title.network !== undefined && title.network !== '' && (
        <span className="poster__network">{title.network}</span>
      )}
      {title.episodeLabel !== undefined && <span className="poster__episode">{title.episodeLabel}</span>}
      <QualityBadges info={title} poster />
      {progress !== undefined && (
        <span className="poster__progress" aria-hidden="true">
          <span className="poster__progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
      <span className="poster__meta">
        <span className="poster__title">{title.title}</span>
        <span className="poster__year">{title.episodeLabel ?? (title.year > 0 ? title.year : '')}</span>
      </span>
    </>
  );
}, (prev, next) => prev.layout === next.layout && prev.decorative === next.decorative && sameTitleFace(prev.title, next.title));

/** Conveyor copies stay out of the focus engine so D-pad hops do not scan 3× tiles. */
function PosterClone({
  title,
  onSelect,
  prefix,
  layout = 'portrait',
  index = 0,
  loopCopy = 0,
}: PosterCardProps): ReactElement {
  const id = posterFocusId(prefix, title.id, index, loopCopy);
  const prefetch = useDetailsPrefetch(title);
  return (
    <LoopClone className={`poster poster--${layout}`} focusId={id} loopCopy={loopCopy} onClick={() => onSelect(title)} {...prefetch}>
      <PosterFace title={title} layout={layout} decorative />
    </LoopClone>
  );
}

function sameTitleFace(a: Title, b: Title): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.poster === b.poster &&
    a.backdrop === b.backdrop &&
    a.progress === b.progress &&
    a.network === b.network &&
    a.episodeLabel === b.episodeLabel &&
    a.year === b.year &&
    a.hue === b.hue &&
    a.kind === b.kind && a.height === b.height && a.hdr === b.hdr && a.audio?.atmos === b.audio?.atmos
  );
}

const PosterFocusable = memo(function PosterFocusable({
  title,
  onSelect,
  prefix,
  layout = 'portrait',
  index = 0,
}: PosterCardProps): ReactElement {
  const id = posterFocusId(prefix, title.id, index, 1);
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    onArrowPress: () => false,
    onFocus: () => {
      const node = ref.current;
      if (node !== null) revealFocused(node);
    },
  });
  const onClick = useCallback(() => {
    onSelect(title);
  }, [onSelect, title]);
  const prefetch = useDetailsPrefetch(title, focused);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={title.title}
      title={title.title}
      className={`poster poster--${layout}`}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-copy="1"
      onClick={onClick}
      {...prefetch}
    >
      <PosterFace title={title} layout={layout} decorative={false} />
    </button>
  );
}, (prev, next) => prev.onSelect === next.onSelect && prev.prefix === next.prefix && prev.layout === next.layout && prev.index === next.index && prev.title === next.title);

export const PosterCard = memo(function PosterCard(props: PosterCardProps): ReactElement {
  if ((props.loopCopy ?? 1) !== 1) return <PosterClone {...props} />;
  return <PosterFocusable {...props} />;
}, (prev, next) =>
  prev.onSelect === next.onSelect &&
  prev.prefix === next.prefix &&
  prev.layout === next.layout &&
  prev.index === next.index &&
  prev.loopCopy === next.loopCopy &&
  prev.title === next.title,
);

export function railPosterIds(prefix: string, titles: readonly Title[]): { firstId: string; lastId: string } | null {
  const first = titles[0];
  const last = titles[titles.length - 1];
  if (first === undefined || last === undefined) return null;
  return {
    firstId: posterFocusId(prefix, first.id, 0, 1),
    lastId: posterFocusId(prefix, last.id, titles.length - 1, 1),
  };
}

export function mapRailPosters(
  titles: readonly Title[],
  prefix: string,
  onSelect: (title: Title) => void,
  extra?: { layout?: 'portrait' | 'landscape' },
): ReactElement[] {
  const wrap = railPosterIds(prefix, titles);
  return titles.map((title, index) => (
    <PosterCard
      key={`${prefix}-${title.id}-${index}`}
      title={title}
      prefix={prefix}
      layout={extra?.layout ?? 'portrait'}
      index={index}
      total={titles.length}
      firstId={wrap?.firstId}
      lastId={wrap?.lastId}
      onSelect={onSelect}
    />
  ));
}
