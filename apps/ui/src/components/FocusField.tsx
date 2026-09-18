import { useEffect, type Ref } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { requestFocus } from '../nav/focusEngine';
import { useScopedFocusKey } from '../nav/ViewStackContext';

export function fieldValue(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-focus-id="${id}"]`)?.value ?? '';
}

export type FieldType = 'text' | 'password' | 'url' | 'search' | 'email' | 'tel';
export type FieldInputMode = 'text' | 'search' | 'url' | 'email' | 'numeric' | 'tel' | 'decimal' | 'none';
export type FieldEnterHint = 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';

interface FocusFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onConfirm: (value: string) => void;
  type?: FieldType;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: FieldInputMode;
  enterKeyHint?: FieldEnterHint;
  /** After a paste, move the highlight to this in-screen control (usually Save). */
  afterPasteFocusId?: string;
  /**
   * Off unless a screen asks. The sign-in form asks, so a password manager and
   * the phone's own keychain can fill it — typing a ten-character password on a
   * TV keyboard is the other option.
   */
  autoComplete?: string;
  name?: string;
  /** Proper nouns and email addresses want different capitalisation. */
  autoCapitalize?: 'off' | 'none' | 'sentences' | 'words' | 'characters';
}

/**
 * The keyboard a phone puts up is chosen by the field, not by the app.
 *
 * On a television every field is the same field: the on-screen keyboard is
 * ours and a D-pad walks it. On a phone the system keyboard reads `type`,
 * `inputMode` and `enterKeyHint` and lays itself out accordingly — an email
 * field gets `@` and `.` on the top row, a URL field gets `/` and `.com`, and
 * `enterKeyHint` decides whether the blue key says Go, Next or Search. Leave
 * them unset and every field gets the plain alphabetic keyboard with a Return
 * key, which is why typing an address here used to mean switching layouts
 * twice.
 *
 * So the sensible keyboard is derived from the type unless the caller names
 * one. Nothing about the remote-first behaviour changes.
 */
const MODE_FOR_TYPE: Readonly<Record<FieldType, FieldInputMode>> = {
  text: 'text',
  password: 'text',
  url: 'url',
  search: 'search',
  email: 'email',
  tel: 'tel',
};

const HINT_FOR_TYPE: Readonly<Record<FieldType, FieldEnterHint>> = {
  text: 'done',
  password: 'go',
  url: 'go',
  search: 'search',
  email: 'next',
  tel: 'done',
};

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
  inputMode,
  enterKeyHint,
  afterPasteFocusId,
  autoComplete = 'off',
  name,
  autoCapitalize,
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
  const mode = inputMode ?? MODE_FOR_TYPE[type];
  const hint = enterKeyHint ?? HINT_FOR_TYPE[type];

  if (multiline) {
    return (
      <textarea
        ref={fieldRef}
        autoComplete={autoComplete}
        spellCheck={false}
        className="token-field__input token-field__input--area"
        tabIndex={-1}
        rows={5}
        name={name}
        data-focus-id={id}
        data-focused={focused ? 'true' : undefined}
        value={value}
        placeholder={placeholder}
        inputMode={mode}
        enterKeyHint={hint}
        autoCapitalize={autoCapitalize ?? 'off'}
        onChange={(event) => onChange(event.currentTarget.value)}
        onPaste={afterPaste}
      />
    );
  }

  return (
    <input
      ref={ref}
      type={type}
      name={name}
      autoComplete={autoComplete}
      spellCheck={false}
      className="token-field__input"
      tabIndex={-1}
      data-focus-id={id}
      data-focused={focused ? 'true' : undefined}
      value={value}
      placeholder={placeholder}
      inputMode={mode}
      enterKeyHint={hint}
      autoCapitalize={autoCapitalize ?? 'off'}
      autoCorrect="off"
      onChange={(event) => onChange(event.currentTarget.value)}
      onPaste={afterPaste}
    />
  );
}
