import type { Session, User } from '@supabase/supabase-js';
import type { PigoowaClient } from '@/services/supabase/client';
import { authFailureCodeOf } from './authErrors';
import type { AuthApi, AuthEvent, AuthResult, AuthUser } from './types';

function toAuthUser(user: User | null | undefined): AuthUser | null {
  if (!user) return null;
  return { id: user.id, email: user.email ?? '' };
}

function failure(error: unknown): { ok: false; code: ReturnType<typeof authFailureCodeOf> } {
  return { ok: false, code: authFailureCodeOf(error) };
}

function toEvent(event: string): AuthEvent | null {
  switch (event) {
    case 'INITIAL_SESSION':
    case 'SIGNED_IN':
      return 'signed-in';
    case 'SIGNED_OUT':
      return 'signed-out';
    case 'USER_UPDATED':
      return 'user-updated';
    default:
      // TOKEN_REFRESHED, PASSWORD_RECOVERY: the user did not change.
      return null;
  }
}

/** The authentication service, over the Supabase client (public key, the user's own session). */
export function createSupabaseAuthApi(client: PigoowaClient): AuthApi {
  return {
    async getSession() {
      try {
        const { data, error } = await client.auth.getSession();
        if (error) return failure(error);
        return { ok: true, value: { user: toAuthUser(data.session?.user) } };
      } catch (error) {
        return failure(error);
      }
    },

    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((event: string, session: Session | null) => {
        const mapped = toEvent(event);
        if (mapped !== null) listener(mapped, toAuthUser(session?.user));
      });
      return () => {
        data.subscription.unsubscribe();
      };
    },

    async signIn(email, password) {
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) return failure(error);
        const user = toAuthUser(data.user);
        return user === null ? { ok: false, code: 'unknown' } : { ok: true, value: { user } };
      } catch (error) {
        return failure(error);
      }
    },

    async signUp(email, password) {
      try {
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) return failure(error);
        // No session = the server wants the e-mail address confirmed first.
        return { ok: true, value: { user: data.session ? toAuthUser(data.user) : null } };
      } catch (error) {
        return failure(error);
      }
    },

    async signOut(): Promise<AuthResult> {
      try {
        const { error } = await client.auth.signOut();
        if (!error) return { ok: true, value: undefined };
        // The server could not be reached: end at least this browser's session. The refresh token then stays
        // valid on the server until it expires or the account signs out elsewhere ("scope: global").
        if (authFailureCodeOf(error) === 'network-error') {
          const local = await client.auth.signOut({ scope: 'local' });
          return local.error ? failure(local.error) : { ok: true, value: undefined };
        }
        return failure(error);
      } catch (error) {
        return failure(error);
      }
    },
  };
}
