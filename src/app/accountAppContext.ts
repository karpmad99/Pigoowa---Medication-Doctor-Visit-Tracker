import { createContext, useContext } from 'react';
import type { AppServices } from '@/services/repositories';

// The wiring of a build that offers accounts (src/main.tsx decides which build it is). It holds the two things
// the session gate (./SessionServices.tsx) needs and that are not React state: how to make the services of a
// signed-in account, and of the demonstration. Both are functions given from outside, so tests supply their
// own and nothing here needs to be mocked.

/** What the application keeps for this tab only: the same shape as the Web Storage API (sessionStorage fits). */
export interface TabStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface AccountAppDependencies {
  /** The services of a signed-in account. Called once per user; the result is kept for as long as she stays. */
  createAccountServices: (options: {
    userId: string;
    timeZone: string;
    onSessionLost: () => void;
  }) => AppServices;
  /** The browser-storage services of the demonstration. Called at most once. */
  createDemoServices: () => AppServices;
}

export const DependenciesContext = createContext<AccountAppDependencies | null>(null);

export interface DemoChoice {
  /** True while the user chose to try the demonstration instead of signing in. */
  isDemo: boolean;
  enterDemo: () => void;
  leaveDemo: () => void;
}

export const DemoChoiceContext = createContext<DemoChoice | null>(null);

export function useAccountDependencies(): AccountAppDependencies {
  const value = useContext(DependenciesContext);
  if (value === null) throw new Error('This page needs an <AccountAppProvider>');
  return value;
}

export function useDemoChoice(): DemoChoice {
  const value = useContext(DemoChoiceContext);
  if (value === null) throw new Error('This page needs an <AccountAppProvider>');
  return value;
}
