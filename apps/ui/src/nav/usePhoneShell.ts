import { useEffect, useState } from 'react';
import { PHONE_SHELL_CLASS } from './phoneViewport';

/**
 * Whether this is running as a phone rather than a television.
 *
 * `startPhoneViewport` owns the answer and writes it to `html.phone-shell`;
 * this only watches. A hook rather than a media query because the class also
 * covers the native iOS shell, which can be a large iPad and would fail a
 * width test, and because the answer has to survive a rotation.
 */
export function readPhoneShell(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains(PHONE_SHELL_CLASS);
}

export function usePhoneShell(): boolean {
  const [phone, setPhone] = useState(readPhoneShell);

  useEffect(() => {
    const sync = (): void => setPhone(readPhoneShell());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return phone;
}
