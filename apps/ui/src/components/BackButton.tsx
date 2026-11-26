import { useNavigate } from '../nav/ViewStackContext';
import { FocusButton } from './FocusButton';
import { IconChevronLeft } from './Icons';

interface BackButtonProps {
  id?: string;
  onSelect?: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * Circular Liquid Glass back button (44px touch target) aligned top-left with
 * page headings on non-tab views.
 */
export function BackButton({
  id = 'back',
  onSelect,
  disabled = false,
  className,
  ariaLabel = 'Back',
}: BackButtonProps): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <FocusButton
      id={id}
      variant="quiet"
      disabled={disabled}
      ariaLabel={ariaLabel}
      title={ariaLabel}
      className={`glass glass--chrome back-btn${className ? ` ${className}` : ''}`}
      onSelect={onSelect ?? (() => navigate.pop())}
    >
      <IconChevronLeft className="back-btn__icon" />
      <span className="back-btn__label">{ariaLabel}</span>
    </FocusButton>
  );
}
