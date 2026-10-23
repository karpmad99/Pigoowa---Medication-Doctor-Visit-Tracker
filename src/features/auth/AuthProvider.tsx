import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthContext, type AuthContextValue, type AuthState } from './authContext';
import type { AuthApi, AuthFailureCode, AuthUser, ProfileApi } from './types';

/**
 * Keeps the state of the sign-in: who is signed in, for how long, and why they are not.
 *
 * - The session itself lives in supabase-js (stored in this browser, refreshed before it expires). This
 *   component only follows it: at start-up, and through `api.onChange` when it changes, also in another tab.
 * - A user is "signed in" for the application only once the profile row exists (`ensureProfile`), because the
 *   time zone comes from it and every data row points at it. Until then, or if it fails, no data is read.
 * - A sign-out the user did not ask for (the server revoked or could not refresh the session) leaves a
 *   notice, so the sign-in page can say that the session expired instead of looking like a fresh start.
 */
export function AuthProvider({
  api,
  profiles,
  browserTimeZone,
  children,
}: {
  api: AuthApi;
  profiles: ProfileApi;
  browserTimeZone: string;
  children: ReactNode;
}) {
  // `undefined`: the session has not been read yet.
  const [sessionUser, setSessionUser] = useState<AuthUser | null | undefined>(undefined);
  const [notice, setNotice] = useState<'session-expired' | null>(null);
  // The outcome of opening the profile, for one user and one attempt. No entry for the current user and attempt
  // means it is still being opened.
  const [profileOutcome, setProfileOutcome] = useState<{
    userId: string;
    attempt: number;
    outcome: { ok: true; timeZone: string } | { ok: false; code: AuthFailureCode };
  } | null>(null);
  const [profileAttempt, setProfileAttempt] = useState(0);
  // Why the session is about to end, when WE end it: the sign-out event that follows is then not a surprise.
  const endedBy = useRef<'user' | 'session-lost' | null>(null);

  // Read the stored session once, then follow its changes.
  useEffect(() => {
    let active = true;
    void api.getSession().then((result) => {
      if (!active) return;
      // A session that cannot be read (for example no network and nothing cached) is treated as none.
      setSessionUser(result.ok ? result.value.user : null);
    });
    const stop = api.onChange((event, user) => {
      if (event === 'signed-out') {
        // Ended by the user: no notice. Ended because a data operation found the session gone: the notice is
        // already set, leave it. Otherwise (the server revoked it, another tab signed out) the session expired.
        if (endedBy.current === 'user') setNotice(null);
        else if (endedBy.current === null) setNotice('session-expired');
        setSessionUser(null);
      } else if (user !== null) {
        // Signed in again (also fired when a tab regains focus): the same user changes nothing.
        setNotice(null);
        setSessionUser((current) => (current?.id === user.id ? current : user));
      }
    });
    return () => {
      active = false;
      stop();
    };
  }, [api]);

  // Open the profile of whoever is signed in. A different user, or a retry, starts over.
  const userId = sessionUser?.id;
  useEffect(() => {
    if (!sessionUser || userId === undefined) return;
    let active = true;
    void profiles.ensureProfile(sessionUser, browserTimeZone).then((result) => {
      if (!active) return;
      setProfileOutcome({
        userId,
        attempt: profileAttempt,
        outcome: result.ok
          ? { ok: true, timeZone: result.value.timeZone }
          : { ok: false, code: result.code },
      });
    });
    return () => {
      active = false;
    };
    // The user object is replaced on every event; only a different id (or a retry) restarts this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profileAttempt, profiles, browserTimeZone]);

  const signIn = useCallback<AuthContextValue['signIn']>(
    async (email, password) => {
      const result = await api.signIn(email, password);
      if (!result.ok) return result;
      setNotice(null);
      setSessionUser(result.value.user);
      return { ok: true, value: undefined };
    },
    [api],
  );

  const signUp = useCallback<AuthContextValue['signUp']>(
    async (email, password) => {
      const result = await api.signUp(email, password);
      if (!result.ok) return result;
      if (result.value.user === null) return { ok: true, value: { confirmationNeeded: true } };
      setNotice(null);
      setSessionUser(result.value.user);
      return { ok: true, value: { confirmationNeeded: false } };
    },
    [api],
  );

  const signOut = useCallback<AuthContextValue['signOut']>(async () => {
    endedBy.current = 'user';
    const result = await api.signOut();
    endedBy.current = null;
    if (!result.ok) return result;
    setNotice(null);
    setSessionUser(null);
    return result;
  }, [api]);

  const sessionLost = useCallback(() => {
    setNotice('session-expired');
    setSessionUser(null);
    // End what is stored here too, so a reload does not bring the dead session back. Best effort.
    endedBy.current = 'session-lost';
    void api.signOut().then(() => {
      endedBy.current = null;
    });
  }, [api]);

  const retryProfile = useCallback(() => {
    setProfileAttempt((attempt) => attempt + 1);
  }, []);

  const state = useMemo<AuthState>(() => {
    if (sessionUser === undefined) return { status: 'loading' };
    if (sessionUser === null) return { status: 'signed-out', notice };
    const opened =
      profileOutcome?.userId === sessionUser.id && profileOutcome.attempt === profileAttempt
        ? profileOutcome.outcome
        : null;
    if (opened === null) return { status: 'loading' };
    if (!opened.ok) return { status: 'profile-failed', user: sessionUser, code: opened.code };
    return { status: 'signed-in', user: sessionUser, timeZone: opened.timeZone };
  }, [sessionUser, notice, profileOutcome, profileAttempt]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signUp, signOut, sessionLost, retryProfile }),
    [state, signIn, signUp, signOut, sessionLost, retryProfile],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
