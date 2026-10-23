import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { createFakeAuth, createFakeProfiles, makeUser } from '@/test/authFakes';
import { AuthProvider } from './AuthProvider';
import type { AuthContextValue } from './authContext';
import { useAuth } from './useAuth';

function Probe({ onValue }: { onValue: (value: AuthContextValue) => void }) {
  const value = useAuth();
  useEffect(() => {
    onValue(value);
  });
  return <p data-testid="status">{value.state.status}</p>;
}

function setup(options: { storedEmail?: string } = {}) {
  const auth = createFakeAuth({
    storedUser: options.storedEmail ? makeUser(options.storedEmail) : null,
  });
  const profiles = createFakeProfiles();
  let latest!: AuthContextValue;
  render(
    <AuthProvider api={auth} profiles={profiles} browserTimeZone="Europe/Warsaw">
      <Probe
        onValue={(value) => {
          latest = value;
        }}
      />
    </AuthProvider>,
  );
  return { auth, profiles, state: () => latest.state, actions: () => latest };
}

async function untilStatus(status: string) {
  await waitFor(() => {
    expect(screen.getByTestId('status')).toHaveTextContent(status);
  });
}

describe('AuthProvider', () => {
  it('starts loading, then is signed out when the browser holds no session', async () => {
    const { state } = setup();

    expect(state().status).toBe('loading');
    await untilStatus('signed-out');
    expect(state()).toEqual({ status: 'signed-out', notice: null });
  });

  it('opens the profile of a stored session before it calls the user signed in', async () => {
    const { state, profiles } = setup({ storedEmail: 'ala@example.com' });

    await untilStatus('signed-in');

    expect(state()).toMatchObject({
      status: 'signed-in',
      user: { email: 'ala@example.com' },
      timeZone: 'Europe/Warsaw',
    });
    expect(profiles.calls).toHaveLength(1);
  });

  it('reads an unreadable stored session as none instead of failing', async () => {
    const auth = createFakeAuth({ storedUser: makeUser('ala@example.com') });
    auth.failWith = 'network-error';
    const profiles = createFakeProfiles();
    render(
      <AuthProvider api={auth} profiles={profiles} browserTimeZone="Europe/Warsaw">
        <Probe onValue={() => undefined} />
      </AuthProvider>,
    );

    await untilStatus('signed-out');
    expect(profiles.calls).toEqual([]);
  });

  it('signs in with the right password and never with a wrong one', async () => {
    const { auth, actions, state } = setup();
    auth.accounts.set('ala@example.com', {
      password: 'tajne-haslo',
      user: makeUser('ala@example.com'),
    });
    await untilStatus('signed-out');

    let wrong: Awaited<ReturnType<AuthContextValue['signIn']>> | undefined;
    await act(async () => {
      wrong = await actions().signIn('ala@example.com', 'zle-haslo');
    });
    expect(wrong).toEqual({ ok: false, code: 'invalid-credentials' });
    expect(state().status).toBe('signed-out');

    await act(async () => {
      await actions().signIn('ala@example.com', 'tajne-haslo');
    });
    await untilStatus('signed-in');
  });

  it('reports a network failure on sign-in and stays signed out', async () => {
    const { auth, actions, state } = setup();
    await untilStatus('signed-out');
    auth.failWith = 'network-error';

    let result: Awaited<ReturnType<AuthContextValue['signIn']>> | undefined;
    await act(async () => {
      result = await actions().signIn('ala@example.com', 'x');
    });

    expect(result).toEqual({ ok: false, code: 'network-error' });
    expect(state()).toEqual({ status: 'signed-out', notice: null });
  });

  it('does not open the data layer when the profile cannot be read, and recovers on retry', async () => {
    const auth = createFakeAuth({ storedUser: makeUser('ala@example.com') });
    const profiles = createFakeProfiles();
    profiles.failWith = 'network-error';
    let latest!: AuthContextValue;
    render(
      <AuthProvider api={auth} profiles={profiles} browserTimeZone="Europe/Warsaw">
        <Probe
          onValue={(value) => {
            latest = value;
          }}
        />
      </AuthProvider>,
    );

    await untilStatus('profile-failed');
    expect(latest.state).toMatchObject({ status: 'profile-failed', code: 'network-error' });

    profiles.failWith = null;
    act(() => {
      latest.retryProfile();
    });
    await untilStatus('signed-in');
    expect(profiles.calls).toHaveLength(2);
  });

  it('leaves a notice when the session ends without the user asking for it', async () => {
    const { auth, state } = setup({ storedEmail: 'ala@example.com' });
    await untilStatus('signed-in');

    act(() => {
      auth.emit('signed-out', null);
    });

    await untilStatus('signed-out');
    expect(state()).toEqual({ status: 'signed-out', notice: 'session-expired' });
  });

  it('leaves no notice when the user signs out herself', async () => {
    const { auth, actions, state } = setup({ storedEmail: 'ala@example.com' });
    await untilStatus('signed-in');

    await act(async () => {
      // The fake announces the end of the session while signing out, as supabase-js does.
      await actions().signOut();
    });

    expect(state()).toEqual({ status: 'signed-out', notice: null });
    expect(auth.calls.signOut).toBe(1);
  });

  it('stays signed in when signing out fails', async () => {
    const { auth, actions, state } = setup({ storedEmail: 'ala@example.com' });
    await untilStatus('signed-in');
    auth.failWith = 'unknown';

    let result: Awaited<ReturnType<AuthContextValue['signOut']>> | undefined;
    await act(async () => {
      result = await actions().signOut();
    });

    expect(result).toEqual({ ok: false, code: 'unknown' });
    expect(state().status).toBe('signed-in');
  });

  it('turns a data operation that found the session gone into a signed-out state with the notice', async () => {
    const { auth, actions, state } = setup({ storedEmail: 'ala@example.com' });
    await untilStatus('signed-in');

    act(() => {
      actions().sessionLost();
    });

    await untilStatus('signed-out');
    expect(state()).toEqual({ status: 'signed-out', notice: 'session-expired' });
    // The dead session is also ended where it is stored, so a reload does not bring it back.
    expect(auth.calls.signOut).toBe(1);
  });

  it('does not open the profile again when the same user is announced again (a tab regaining focus)', async () => {
    const { auth, profiles } = setup({ storedEmail: 'ala@example.com' });
    await untilStatus('signed-in');

    act(() => {
      auth.emit('signed-in', makeUser('ala@example.com'));
    });

    expect(profiles.calls).toHaveLength(1);
  });

  it('opens the profile of another user when the session changes to one, in another tab', async () => {
    const { auth, profiles, state } = setup({ storedEmail: 'ala@example.com' });
    await untilStatus('signed-in');

    act(() => {
      auth.emit('signed-in', makeUser('ola@example.com'));
    });

    await waitFor(() => {
      expect(state()).toMatchObject({ status: 'signed-in', user: { email: 'ola@example.com' } });
    });
    expect(profiles.calls).toEqual(['user-ala@example.com', 'user-ola@example.com']);
  });

  it('reports an account that must confirm its e-mail without signing it in', async () => {
    const { auth, actions, state } = setup();
    auth.requireConfirmation = true;
    await untilStatus('signed-out');

    let result: Awaited<ReturnType<AuthContextValue['signUp']>> | undefined;
    await act(async () => {
      result = await actions().signUp('nowy@example.com', 'dlugie-haslo-1');
    });

    expect(result).toEqual({ ok: true, value: { confirmationNeeded: true } });
    expect(state().status).toBe('signed-out');
  });
});
