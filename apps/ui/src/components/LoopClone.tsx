import type { MouseEventHandler, PointerEventHandler, ReactNode } from 'react';

/** Conveyor copies stay out of norigin so D-pad hops do not scan 3× tiles. */
export function LoopClone({
  className,
  focusId,
  loopCopy,
  title,
  ambientArt,
  ambientHue,
  onClick,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  className: string;
  focusId: string;
  loopCopy: number;
  title?: string;
  ambientArt?: string;
  ambientHue?: number;
  onClick?: MouseEventHandler;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={className}
      data-focus-id={focusId}
      data-loop-clone="true"
      data-loop-copy={String(loopCopy)}
      title={title}
      data-ambient-art={ambientArt}
      data-ambient-hue={ambientHue}
      aria-hidden="true"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  );
}
