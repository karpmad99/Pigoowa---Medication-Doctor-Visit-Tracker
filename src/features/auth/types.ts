/** Why an authentication operation failed. The screens choose their wording from this code alone. */
export type AuthFailureCode =
  /** Wrong e-mail or password. Deliberately one code: the screen must not say which of the two was wrong. */
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'email-taken'
  | 'weak-password'
  | 'invalid-email'
  | 'rate-limited'
  | 'sign-up-disabled'
  /** The server could not be reached. Nothing was changed. */
  | 'network-error'
  /** The stored session is no longer valid (expired, revoked, or refreshed elsewhere). */
  | 'session-expired'
  | 'unknown';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthResult<T = void> = { ok: true; value: T } | { ok: false; code: AuthFailureCode };

export type AuthEvent = 'signed-in' | 'signed-out' | 'user-updated';

/**
 * What the application needs from the authentication service. `supabaseAuthApi.ts` implements it over
 * supabase-js; the screens and the provider know only this interface.
 */
export interface AuthApi {
  /** The session stored in this browser, refreshed if it had expired. `user: null` means signed out. */
  getSession(): Promise<AuthResult<{ user: AuthUser | null }>>;
  /** Calls `listener` whenever the session changes (also from another tab). Returns the way to stop. */
  onChange(listener: (event: AuthEvent, user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthResult<{ user: AuthUser }>>;
  /**
   * `user` is the new session's user, or `null` when the account needs its e-mail confirmed before the
   * first sign-in (the server then sends no session).
   */
  signUp(email: string, password: string): Promise<AuthResult<{ user: AuthUser | null }>>;
  /** Ends this browser's session, also when the server cannot be reached. */
  signOut(): Promise<AuthResult>;
}

/** The part of the user's profile row the application reads. */
export interface Profile {
  timeZone: string;
}

export interface ProfileApi {
  /** Reads the profile of the signed-in user, creating the row if the account has none yet. */
  ensureProfile(user: AuthUser, browserTimeZone: string): Promise<AuthResult<Profile>>;
}
