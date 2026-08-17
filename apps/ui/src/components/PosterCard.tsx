import { type ReactElement } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import type { Title } from '../data/catalog';
import { revealFocused } from '../nav/revealFocused';
import { useScopedFocusKey } from '../nav/ViewStackContext';
import { Artwork } from './Artwork';

interface PosterCardProps {
  title: Title;
  onSelect: () => void;
  prefix: string;
  layout?: 'portrait' | 'landscape';
  index?: number;
  total?: number;
  firstId?: string;
  lastId?: string;
  loopCopy?: number;
}

export function PosterCard({
  title,
  onSelect,
  prefix,
  layout = 'portrait',
  loopCopy = 1,
}: PosterCardProps): ReactElement {
  const clone = loopCopy !== 1;
  const id = clone ? `${prefix}-${title.id}--${loopCopy}` : `${prefix}-${title.id}`;
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: !clone,
    onArrowPress: () => true,
    onFocus: () => {
      const node = ref.current;
      if (node !== null) requestAnimationFrame(() => revealFocused(node));
    },
  });

  const progress = title.progress;

  return (
    <button
      ref={ref}
      type="button"
      className={`poster poster--${layout}`}
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-clone={clone ? 'true' : undefined}
      data-loop-copy={String(loopCopy)}
      onClick={onSelect}
    >
      <Artwork title={title} kind={layout === 'landscape' ? 'backdrop' : 'poster'} className="poster__art" />
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
    </button>
  );
}

export function railPosterIds(prefix: string, titles: readonly Title[]): { firstId: string; lastId: string } | null {
  const first = titles[0];
  const last = titles[titles.length - 1];
  if (first === undefined || last === undefined) return null;
  return { firstId: `${prefix}-${first.id}`, lastId: `${prefix}-${last.id}` };
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
      key={`${prefix}-${title.id}`}
      title={title}
      prefix={prefix}
      layout={extra?.layout ?? 'portrait'}
      index={index}
      total={titles.length}
      firstId={wrap?.firstId}
      lastId={wrap?.lastId}
      onSelect={() => onSelect(title)}
    />
  ));
}
