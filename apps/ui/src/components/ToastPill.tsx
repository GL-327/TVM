import { useCallback, useEffect, useRef, useState } from 'react';

export function useToast(durationMs = 2200): {
  message: string | null;
  showToast: (text: string) => void;
} {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef(0);

  const showToast = useCallback(
    (text: string): void => {
      window.clearTimeout(timerRef.current);
      setMessage(text);
      timerRef.current = window.setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return { message, showToast };
}

export function ToastPill({ message }: { message: string | null }): React.JSX.Element | null {
  if (message === null) return null;
  return (
    <div className="tvm-toast" role="status" aria-live="polite">
      <span className="tvm-toast__dot" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
