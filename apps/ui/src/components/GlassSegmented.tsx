import { useRef } from 'react';
import { FocusButton } from './FocusButton';
import { SelectionDroplet } from './SelectionDroplet';
import { useLiquidLens } from './liquidLens';

export interface SegmentedOption<T extends string = string> {
  id: T;
  label: string;
}

export function GlassSegmented<T extends string>({
  idPrefix, ariaLabel, options, value, onChange, className,
}: {
  idPrefix: string; ariaLabel: string; options: readonly SegmentedOption<T>[];
  value: T; onChange: (value: T) => void; className?: string;
}): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  useLiquidLens(track);
  return (
    <div ref={track} role="radiogroup" aria-label={ariaLabel}
      className={`glass-segment ${className ?? ''}`} data-wrap="row">
      <SelectionDroplet track={track} selected={`${idPrefix}-${value}`} className="glass-segment__thumb" />
      {options.map((option) => (
        <FocusButton key={option.id} id={`${idPrefix}-${option.id}`} role="radio"
          ariaChecked={option.id === value} tabIndex={0}
          className={`glass-segment__option${option.id === value ? ' glass-segment__option--active' : ''}`}
          onSelect={() => onChange(option.id)}>
          {option.label}
        </FocusButton>
      ))}
    </div>
  );
}
