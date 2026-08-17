import { createContext, useContext } from 'react';
import type { PushOptions, ViewStackState } from '@tvm/nav';

export interface Navigate {
  push: (name: string, options?: PushOptions) => void;
  pushModal: (name: string, options?: PushOptions) => void;
  replace: (name: string, options?: PushOptions) => void;
  pop: () => void;
  home: () => void;
  reset: (name: string, options?: PushOptions) => void;
}

interface ViewStackContextValue {
  state: ViewStackState;
  navigate: Navigate;
}

const ViewStackContext = createContext<ViewStackContextValue | null>(null);

export const ViewStackContextProvider = ViewStackContext.Provider;

export function useViewStack(): ViewStackState {
  return useRequiredContext().state;
}

export function useNavigate(): Navigate {
  return useRequiredContext().navigate;
}

function useRequiredContext(): ViewStackContextValue {
  const value = useContext(ViewStackContext);
  if (value === null) throw new Error('Navigation was used outside ViewStackProvider');
  return value;
}

/**
 * Focus keys are scoped to the stack entry that owns them, so two pushes of
 * the same screen never fight over one key and a remembered key stays valid
 * for exactly the instance it came from.
 */
const FocusScopeContext = createContext<string>('root');

export const FocusScopeProvider = FocusScopeContext.Provider;

export function useFocusScope(): string {
  return useContext(FocusScopeContext);
}

export function useScopedFocusKey(id: string): string {
  return `${useFocusScope()}/${id}`;
}
