import { memo, useState, type CSSProperties, type ReactNode } from 'react';
import { normalizeArtUrl } from '../data/artwork';
import { usePhosphorSrc } from '../theme/usePhosphorSrc';
import { ART_REFERRER, artClassName, markArtReady, paintArtReady } from './artFace';
import { FocusButton } from './FocusButton';
import { LoopClone } from './LoopClone';
import './ChannelCard.css';

export interface ChannelCardData {
  id: string;
  name: string;
  group?: string;
  logo?: string;
  picked?: boolean;
}

function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 33 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function ChannelFace({
  channel,
  hue,
  initial,
  group,
  picking,
  selected,
  clone,
}: {
  channel: ChannelCardData;
  hue: number;
  initial: string;
  group: string;
  picking: boolean;
  selected: boolean;
  clone: boolean;
}): ReactNode {
  const original = normalizeArtUrl(channel.logo ?? '');
  const { src: logo, waiting } = usePhosphorSrc(original, 'logo');
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showLogo = original !== '' && failedSrc !== original;

  return (
    <>
      <span
        className={artClassName(showLogo ? 'pending' : 'fallback', 'channel-card__art')}
        style={{ '--channel-hue': String(hue) } as CSSProperties}
      >
        {clone || !showLogo ? null : <span className="skeleton skeleton--art" />}
        {showLogo && !waiting ? (
          <img
            key={logo}
            className="channel-card__logo"
            src={logo}
            alt=""
            loading="lazy"
            fetchPriority={clone ? 'low' : 'high'}
            decoding="async"
            referrerPolicy={ART_REFERRER}
            draggable={false}
            onLoad={(event) => markArtReady(event.currentTarget)}
            onError={() => setFailedSrc(original)}
            ref={paintArtReady}
          />
        ) : showLogo ? null : (
          <span className="channel-card__initial">{initial}</span>
        )}
        {picking ? <span className={`channel-card__mark${selected ? ' channel-card__mark--on' : ''}`}>{selected ? 'On' : 'Add'}</span> : null}
        {!picking && channel.id.startsWith('live:mock:') ? <span className="channel-card__mark">Sample</span> : null}
      </span>
      <strong className="channel-card__name">{channel.name}</strong>
      <span className="channel-card__group">{group}</span>
    </>
  );
}

export const ChannelCard = memo(function ChannelCard({
  channel,
  focusId,
  picking = false,
  onSelect,
  loopCopy = 1,
}: {
  channel: ChannelCardData;
  focusId: string;
  picking?: boolean;
  onSelect: () => void;
  loopCopy?: number;
}): React.JSX.Element {
  const selected = channel.picked === true;
  const hue = hueFor(channel.name);
  const initial = (channel.name.trim().charAt(0) || '#').toUpperCase();
  const group = channel.group?.trim() || 'Live';
  const clone = loopCopy !== 1;
  const id = clone ? `${focusId}--${loopCopy}` : focusId;
  const className = `channel-card${selected ? ' channel-card--on' : ''}${picking ? ' channel-card--pick' : ''}`;
  const face = (
    <ChannelFace
      channel={channel}
      hue={hue}
      initial={initial}
      group={group}
      picking={picking}
      selected={selected}
      clone={clone}
    />
  );

  if (clone) {
    return (
      <LoopClone className={`tvm-button tvm-button--standard ${className}`} focusId={id} loopCopy={loopCopy} onClick={onSelect}>
        <span className="tvm-button__label">{face}</span>
      </LoopClone>
    );
  }

  return (
    <FocusButton id={id} className={className} onSelect={onSelect} dataLoopCopy={1} onArrowPress={() => false}>
      {face}
    </FocusButton>
  );
});
