import type {
  AuthApi,
  AuthEvent,
  AuthFailureCode,
  AuthResult,
  AuthUser,
  Profile,
  ProfileApi,
} from '@/features/auth/types';

// Stand-ins for the authentication service and the profile store, for tests of the screens and of the
// provider. They are doubles of the INTERFACES in src/features/auth/types.ts: how the real ones behave
// against a real server is checked in supabase/tests/client and in the account end-to-end tests.

export interface FakeAuth extends AuthApi {
  /** What the next calls answer. Change it between steps of a test. */
  accounts: Map<string, { password: string; user: AuthUser }>;
  /** The user whose session is "stored in the browser" at start-up. */
  storedUser: AuthUser | null;
  /** When set, every call fails with this code (a server that cannot be reached, for instance). */
  failWith: AuthFailureCode | null;
  /** Fires an event as if it came from the auth service (another tab, an expired session…). */
  emit(event: AuthEvent, user: AuthUser | null): void;
  calls: { signIn: number; signUp: number; signOut: number };
  /** Accounts that sign up with `confirmationNeeded`. */
  requireConfirmation: boolean;
}

export function makeUser(email: string, id = `user-${email}`): AuthUser {
  return { id, email };
}

export function createFakeAuth(initial: { storedUser?: AuthUser | null } = {}): FakeAuth {
  const listeners = new Set<(event: AuthEvent, user: AuthUser | null) => void>();
  const fake: FakeAuth = {
    accounts: new Map(),
    storedUser: initial.storedUser ?? null,
    failWith: null,
    requireConfirmation: false,
    calls: { signIn: 0, signUp: 0, signOut: 0 },
    emit(event, user) {
      for (const listener of listeners) listener(event, user);
    },
    getSession() {
      if (fake.failWith !== null) return Promise.resolve({ ok: false, code: fake.failWith });
      return Promise.resolve({ ok: true, value: { user: fake.storedUser } });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signIn(email, password) {
      fake.calls.signIn += 1;
      if (fake.failWith !== null) return Promise.resolve({ ok: false, code: fake.failWith });
      const account = fake.accounts.get(email);
      if (account?.password !== password) {
        return Promise.resolve({ ok: false, code: 'invalid-credentials' });
      }
      fake.storedUser = account.user;
      return Promise.resolve({ ok: true, value: { user: account.user } });
    },
    signUp(email, password) {
      fake.calls.signUp += 1;
      if (fake.failWith !== null) return Promise.resolve({ ok: false, code: fake.failWith });
      if (fake.accounts.has(email)) return Promise.resolve({ ok: false, code: 'email-taken' });
      const user = makeUser(email);
      fake.accounts.set(email, { password, user });
      if (fake.requireConfirmation) return Promise.resolve({ ok: true, value: { user: null } });
      fake.storedUser = user;
      return Promise.resolve({ ok: true, value: { user } });
    },
    signOut(): Promise<AuthResult> {
      fake.calls.signOut += 1;
      if (fake.failWith !== null) return Promise.resolve({ ok: false, code: fake.failWith });
      fake.storedUser = null;
      // supabase-js announces the end of the session to every listener before signOut returns.
      fake.emit('signed-out', null);
      return Promise.resolve({ ok: true, value: undefined });
    },
  };
  return fake;
}

export interface FakeProfiles extends ProfileApi {
  profiles: Map<string, Profile>;
  failWith: AuthFailureCode | null;
  calls: string[];
}

export function createFakeProfiles(): FakeProfiles {
  const fake: FakeProfiles = {
    profiles: new Map(),
    failWith: null,
    calls: [],
    ensureProfile(user, browserTimeZone) {
      fake.calls.push(user.id);
      if (fake.failWith !== null) return Promise.resolve({ ok: false, code: fake.failWith });
      const existing = fake.profiles.get(user.id);
      if (existing) return Promise.resolve({ ok: true, value: existing });
      const created = { timeZone: browserTimeZone };
      fake.profiles.set(user.id, created);
      return Promise.resolve({ ok: true, value: created });
    },
  };
  return fake;
}
