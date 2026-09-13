import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ScreenBoundaryProps {
  children: ReactNode;
  /** Remounts the boundary when the visible screen changes, clearing a stale error. */
  resetKey?: string;
  onReset?: () => void;
}

interface ScreenBoundaryState {
  error: Error | null;
  resetKey: string | undefined;
}

/**
 * Catches a render crash so one bad screen cannot take down the appliance.
 *
 * Before this existed, only the player had a boundary. A throw anywhere else —
 * a catalog payload in an unexpected shape, a null deref in a rail — unmounted
 * the whole React tree and left a black screen with a dead remote, which on a TV
 * with no keyboard means pulling the plug. Here the viewer keeps a working Back
 * button, and navigating away resets the boundary via resetKey.
 */
export class ScreenBoundary extends Component<ScreenBoundaryProps, ScreenBoundaryState> {
  constructor(props: ScreenBoundaryProps) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<ScreenBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ScreenBoundaryProps,
    state: ScreenBoundaryState,
  ): Partial<ScreenBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as console output: the appliance ships a diagnostics screen that
    // reads the console ring buffer, and there is no other reporter on a TV.
    console.error('TVM screen crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <section className="empty-state" role="alert">
        <p className="stage__kicker">Something went wrong</p>
        <h2 className="empty-state__title">This screen could not be shown</h2>
        <p className="page__lede">
          The rest of TVM is still running. Press Back to return to where you were.
        </p>
      </section>
    );
  }
}
