import { useEffect } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { requestFocus } from '../nav/focusEngine';
import { useScopedFocusKey } from '../nav/ViewStackContext';

export function fieldValue(id: string): string {
  return document.querySelector<HTMLInputElement>(`[data-focus-id="${id}"]`)?.value ?? '';
}

interface FocusFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onConfirm: (value: string) => void;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  /** After a paste, move the highlight to this in-screen control (usually Save). */
  afterPasteFocusId?: string;
}

/**
 * Remote-first text field. OK/Enter confirms. D-pad up/down leaves the field
 * so Continue stays reachable. Paste still works from a keyboard.
 */
export function FocusField({
  id,
  value,
  onChange,
  onConfirm,
  type = 'text',
  placeholder,
  afterPasteFocusId,
}: FocusFieldProps): React.JSX.Element {
  const focusKey = useScopedFocusKey(id);
  const saveKey = useScopedFocusKey(afterPasteFocusId ?? '');
  const { ref, focused } = useFocusable<object, HTMLInputElement>({ focusKey });

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const confirm = (): void => onConfirm(node.value);
    node.addEventListener('tvm:field-confirm', confirm);
    return () => node.removeEventListener('tvm:field-confirm', confirm);
  }, [onConfirm, ref]);

  return (
    <input
      ref={ref}
      type={type}
      autoComplete="off"
      spellCheck={false}
      className="token-field__input"
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onPaste={() => {
        window.setTimeout(() => {
          const node = ref.current;
          if (node !== null) onChange(node.value);
          if (afterPasteFocusId !== undefined) requestFocus(saveKey);
        }, 0);
      }}
    />
  );
}
