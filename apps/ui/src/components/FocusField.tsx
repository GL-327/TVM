import { useEffect, type Ref } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { requestFocus } from '../nav/focusEngine';
import { useScopedFocusKey } from '../nav/ViewStackContext';

export function fieldValue(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-focus-id="${id}"]`)?.value ?? '';
}

interface FocusFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onConfirm: (value: string) => void;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  multiline?: boolean;
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
  multiline = false,
  afterPasteFocusId,
}: FocusFieldProps): React.JSX.Element {
  const focusKey = useScopedFocusKey(id);
  const saveKey = useScopedFocusKey(afterPasteFocusId ?? '');
  const { ref, focused } = useFocusable<object, HTMLInputElement>({
    focusKey,
    onArrowPress: (direction) => {
      if (direction === 'down' && afterPasteFocusId !== undefined) {
        requestFocus(saveKey);
        return false;
      }
      return true;
    },
  });

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const confirm = (): void => onConfirm(node.value);
    node.addEventListener('tvm:field-confirm', confirm);
    return () => node.removeEventListener('tvm:field-confirm', confirm);
  }, [onConfirm, ref]);

  const afterPaste = (): void => {
    window.setTimeout(() => {
      const node = ref.current;
      if (node !== null) onChange(node.value);
      if (afterPasteFocusId !== undefined) requestFocus(saveKey);
    }, 0);
  };

  const fieldRef = ref as unknown as Ref<HTMLTextAreaElement & HTMLInputElement>;

  if (multiline) {
    return (
      <textarea
        ref={fieldRef}
        autoComplete="off"
        spellCheck={false}
        className="token-field__input token-field__input--area"
        tabIndex={-1}
        rows={5}
        data-focus-id={id}
        data-focused={focused ? 'true' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        onPaste={afterPaste}
      />
    );
  }

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
      onChange={(event) => onChange(event.currentTarget.value)}
      onPaste={afterPaste}
    />
  );
}
