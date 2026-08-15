import { useCallback, useEffect, useRef, useState } from 'react';
import { onIntent } from '@tvm/nav';
import { useCoreHealth } from './useCoreHealth';
import { Diagnostics } from './Diagnostics';

const ACTIONS = ['continue', 'diagnostics'] as const;
type ActionId = (typeof ACTIONS)[number];

const LABELS: Record<ActionId, string> = {
  continue: 'Continue',
  diagnostics: 'System info',
};

/**
 * Phase 1 splash: proves the appliance renders, takes remote input and can
 * reach core. The real focus engine and view stack arrive in Phase 2, so focus
 * here is a deliberately small local implementation rather than a framework.
 */
export function App(): React.JSX.Element {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const health = useCoreHealth();

  useEffect(() => {
    if (showDiagnostics) return;
    buttonRefs.current[focusedIndex]?.focus();
  }, [focusedIndex, showDiagnostics]);

  const activate = useCallback((action: ActionId) => {
    if (action === 'diagnostics') setShowDiagnostics(true);
    if (action === 'continue') setShowDiagnostics(false);
  }, []);

  useEffect(() => {
    return onIntent(window, ({ intent }) => {
      if (intent === 'back') {
        setShowDiagnostics(false);
        return;
      }
      if (showDiagnostics) return;

      if (intent === 'left') setFocusedIndex((index) => Math.max(0, index - 1));
      if (intent === 'right') setFocusedIndex((index) => Math.min(ACTIONS.length - 1, index + 1));
      if (intent === 'select') {
        const action = ACTIONS[focusedIndex];
        if (action !== undefined) activate(action);
      }
    });
  }, [activate, focusedIndex, showDiagnostics]);

  return (
    <main className="splash">
      <div className="splash__glow" aria-hidden="true" />

      <header className="splash__brand">
        <h1 className="splash__wordmark">TVM</h1>
        <p className="splash__tagline">Your television, put back in your hands.</p>
      </header>

      <nav className="splash__actions" aria-label="Start">
        {ACTIONS.map((action, index) => (
          <button
            key={action}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            className={`tvm-button${index === 0 ? ' tvm-button--primary' : ''}`}
            onFocus={() => setFocusedIndex(index)}
            onClick={() => activate(action)}
          >
            {LABELS[action]}
          </button>
        ))}
      </nav>

      <footer className="splash__footer">
        <span className={`status status--${health.status}`}>
          <span className="status__dot" aria-hidden="true" />
          {health.status === 'online' && `Core ${health.version}`}
          {health.status === 'connecting' && 'Connecting to core'}
          {health.status === 'offline' && 'Core unavailable'}
        </span>
        <span className="splash__hint">D-pad to move, OK to select, Back to return</span>
      </footer>

      {showDiagnostics && <Diagnostics health={health} onClose={() => setShowDiagnostics(false)} />}
    </main>
  );
}
