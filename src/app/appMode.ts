import { createContext, useContext } from 'react';

/**
 * Which version of the application is running, for the parts of the screen that differ:
 * - `demo`: fictional data kept in this browser (the demonstration, PROJECT_SPEC DEC-42). `leaveDemo` exists
 *   when the build also offers accounts: it ends the demonstration and returns to the sign-in page.
 * - `account`: the data of the signed-in user, kept in her Supabase account.
 * Without a provider (every test of a single page, and the build without accounts) it is the plain demo.
 */
export type AppMode =
  | { kind: 'demo'; leaveDemo: (() => void) | null }
  | { kind: 'account'; email: string; signOut: () => Promise<{ ok: boolean }> };

export const AppModeContext = createContext<AppMode>({ kind: 'demo', leaveDemo: null });

export function useAppMode(): AppMode {
  return useContext(AppModeContext);
}
