import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import type { ReactNode } from 'react';
import { revealFocused } from '../nav/revealFocused';
import { useScopedFocusKey } from '../nav/ViewStackContext';
import './FocusButton.css';

export type ButtonVariant = 'primary' | 'standard' | 'quiet';

interface FocusButtonProps {
  /** Unique within the owning screen; scoped to it automatically. */
  id: string;
  onSelect: () => void;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
  /** Secondary line, for list rows that state their current value. */
  detail?: string;
  disabled?: boolean;
  onArrowPress?: (direction: string) => boolean;
  dataLoopCopy?: number;
}

/**
 * The only focusable control in the interface.
 *
 * Activation is a click handler rather than the focus library's enter
 * callback: the remote's OK button arrives as an intent, which suppresses the
 * browser's own enter-to-click, so there is exactly one way in.
 */
export function FocusButton({
  id,
  onSelect,
  children,
  variant = 'standard',
  className,
  detail,
  disabled = false,
  onArrowPress,
  dataLoopCopy,
}: FocusButtonProps): React.JSX.Element {
  const focusKey = useScopedFocusKey(id);
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    focusable: !disabled,
    onArrowPress,
    onFocus: () => {
      const node = ref.current;
      if (node !== null) revealFocused(node);
    },
  });

  const classes = ['tvm-button', `tvm-button--${variant}`, focused ? 'tvm-button--focused' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      // Kept out of the tab order: the appliance is driven by a D-pad, and
      // the focus engine moves focus itself.
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      data-loop-copy={dataLoopCopy !== undefined ? String(dataLoopCopy) : undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="tvm-button__label">{children}</span>
      {detail !== undefined && <span className="tvm-button__detail">{detail}</span>}
    </button>
  );
}
