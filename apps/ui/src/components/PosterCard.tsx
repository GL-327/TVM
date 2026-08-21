import { memo, useCallback, type ReactElement, type ReactNode } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import type { Title } from '../data/catalog';
import { revealFocused } from '../nav/revealFocused';
import { useScopedFocusKey } from '../nav/ViewStackContext';
import { Artwork } from './Artwork';
import { LoopClone } from './LoopClone';

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

function PosterFace({
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
}

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
  return (
    <LoopClone className={`poster poster--${layout}`} focusId={id} loopCopy={loopCopy} onClick={() => onSelect(title)}>
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
    a.kind === b.kind
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

  return (
    <button
      ref={ref}
      type="button"
      className={`poster poster--${layout}`}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-copy="1"
      onClick={onClick}
    >
      <PosterFace title={title} layout={layout} decorative={false} />
    </button>
  );
}, (prev, next) => prev.onSelect === next.onSelect && prev.prefix === next.prefix && prev.layout === next.layout && prev.index === next.index && sameTitleFace(prev.title, next.title));

export const PosterCard = memo(function PosterCard(props: PosterCardProps): ReactElement {
  if ((props.loopCopy ?? 1) !== 1) return <PosterClone {...props} />;
  return <PosterFocusable {...props} />;
}, (prev, next) =>
  prev.onSelect === next.onSelect &&
  prev.prefix === next.prefix &&
  prev.layout === next.layout &&
  prev.index === next.index &&
  prev.loopCopy === next.loopCopy &&
  sameTitleFace(prev.title, next.title),
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
