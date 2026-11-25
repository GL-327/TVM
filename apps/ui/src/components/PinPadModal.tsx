import { useCallback, useEffect, useState } from 'react';
import { getParentalContent } from '../data/content';
import { isValidPinFormat } from '../data/pin';
import { FocusButton } from './FocusButton';

interface PinPadModalProps {
  title: string;
  subtitle?: string;
  busy?: boolean;
  error?: string | null;
  cooldownSeconds?: number;
  shakeKey?: number;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Del'] as const;

export function PinPadModal({
  title,
  subtitle,
  busy = false,
  error = null,
  cooldownSeconds = 0,
  shakeKey = 0,
  onSubmit,
  onCancel,
}: PinPadModalProps): React.JSX.Element {
  const digits = getParentalContent().pin.digits;
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const disabled = busy || cooldownSeconds > 0;

  useEffect(() => {
    setPin('');
  }, [shakeKey]);

  const appendDigit = useCallback(
    (d: string): void => {
      if (disabled) return;
      setLocalError(null);
      setPin((prev) => {
        if (prev.length >= digits) return prev;
        const next = `${prev}${d}`;
        if (next.length === digits && isValidPinFormat(next)) {
          window.setTimeout(() => onSubmit(next), 40);
        }
        return next;
      });
    },
    [digits, disabled, onSubmit],
  );

  const backspace = useCallback((): void => {
    if (disabled) return;
    setLocalError(null);
    setPin((prev) => prev.slice(0, -1));
  }, [disabled]);

  const clear = useCallback((): void => {
    if (disabled) return;
    setLocalError(null);
    setPin('');
  }, [disabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        appendDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        if (pin.length > 0) backspace();
        else onCancel();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === 'Enter' && pin.length === digits && !disabled) {
        event.preventDefault();
        event.stopPropagation();
        onSubmit(pin);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [appendDigit, backspace, digits, disabled, onCancel, onSubmit, pin]);

  const activeMessage =
    cooldownSeconds > 0
      ? `Too many wrong attempts. Try again in ${cooldownSeconds}s.`
      : (error ?? localError);

  return (
    <div className="panel-scrim pin-modal" role="dialog" aria-modal="true" aria-label={title}>
      <section className="pin-sheet glass glass--sheet glass-appear">
        <p className="stage__kicker">Profile lock</p>
        <h2 className="pin-sheet__title">{title}</h2>
        {subtitle !== undefined && <p className="page__lede">{subtitle}</p>}

        <div key={shakeKey} className={`pin-dots${shakeKey > 0 ? ' pin-dots--shake' : ''}`} aria-label={`Entered ${pin.length} of ${digits} digits`}>
          {Array.from({ length: digits }, (_, idx) => (
            <span key={idx} className={`pin-dot${idx < pin.length ? ' pin-dot--filled' : ''}`} />
          ))}
        </div>

        {activeMessage !== null && (
          <p className="pin-sheet__error" role="alert">
            {activeMessage}
          </p>
        )}

        <div className="pin-grid" data-wrap="grid" aria-label="PIN keypad">
          {KEYS.map((key) => {
            if (key === 'Clear') {
              return (
                <FocusButton key={key} id="pin-clear" className="pin-key tvm-button--glass" disabled={disabled} onSelect={clear}>
                  Clear
                </FocusButton>
              );
            }
            if (key === 'Del') {
              return (
                <FocusButton key={key} id="pin-del" className="pin-key tvm-button--glass" disabled={disabled} onSelect={backspace}>
                  Del
                </FocusButton>
              );
            }
            return (
              <FocusButton
                key={key}
                id={`pin-${key}`}
                className="pin-key tvm-button--glass"
                disabled={disabled}
                onSelect={() => appendDigit(key)}
              >
                {key}
              </FocusButton>
            );
          })}
        </div>

        <div className="pin-sheet__actions" data-wrap="row">
          <FocusButton id="pin-cancel" className="tvm-button--glass" onSelect={onCancel}>
            Cancel
          </FocusButton>
        </div>
      </section>
    </div>
  );
}
