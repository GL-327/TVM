import type { MouseEventHandler, PointerEventHandler, ReactNode } from 'react';

/** Conveyor copies stay out of norigin so D-pad hops do not scan 3× tiles. */
export function LoopClone({
  className,
  focusId,
  loopCopy,
  onClick,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  className: string;
  focusId: string;
  loopCopy: number;
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
      aria-hidden="true"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  );
}
