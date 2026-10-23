import { createContext } from 'react';
import type { AuthFailureCode, AuthResult, AuthUser } from './types';

export type AuthState =
  /** The stored session is being read. */
  | { status: 'loading' }
  /** Nobody is signed in. `notice` says why the user is back at the sign-in page, if not by choice. */
  | { status: 'signed-out'; notice: 'session-expired' | null }
  /** Signed in, but the profile could not be read or created: the data layer is not opened until it can. */
  | { status: 'profile-failed'; user: AuthUser; code: AuthFailureCode }
  | { status: 'signed-in'; user: AuthUser; timeZone: string };

export interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  /** `confirmationNeeded`: the account exists but must confirm its e-mail address before signing in. */
  signUp: (email: string, password: string) => Promise<AuthResult<{ confirmationNeeded: boolean }>>;
  signOut: () => Promise<AuthResult>;
  /** Called when a data operation found that the session is gone: ends it and tells the user. */
  sessionLost: () => void;
  /** Tries again to read or create the profile after `profile-failed`. */
  retryProfile: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
