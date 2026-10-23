import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  AuthWeakPasswordError,
} from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { authFailureCodeOf, authFailureMessage } from './authErrors';
import type { AuthFailureCode } from './types';

// The error classes are supabase-js's own, built the way it builds them, so this checks the real shapes.

describe('authFailureCodeOf', () => {
  it.each<[string, number, AuthFailureCode]>([
    ['invalid_credentials', 400, 'invalid-credentials'],
    ['email_not_confirmed', 400, 'email-not-confirmed'],
    ['user_already_exists', 422, 'email-taken'],
    ['email_exists', 422, 'email-taken'],
    ['weak_password', 422, 'weak-password'],
    ['email_address_invalid', 400, 'invalid-email'],
    ['over_request_rate_limit', 429, 'rate-limited'],
    ['over_email_send_rate_limit', 429, 'rate-limited'],
    ['signup_disabled', 422, 'sign-up-disabled'],
    ['refresh_token_not_found', 400, 'session-expired'],
    ['refresh_token_already_used', 400, 'session-expired'],
    ['session_not_found', 403, 'session-expired'],
    ['bad_jwt', 403, 'session-expired'],
  ])('maps the server code %s to %s', (serverCode, status, expected) => {
    expect(authFailureCodeOf(new AuthApiError('server text', status, serverCode))).toBe(expected);
  });

  it('treats "no answer from the server" as a network failure, whatever the cause', () => {
    expect(authFailureCodeOf(new AuthRetryableFetchError('fetch failed', 0))).toBe('network-error');
    expect(authFailureCodeOf(new AuthRetryableFetchError('Bad gateway', 502))).toBe(
      'network-error',
    );
    expect(authFailureCodeOf(new TypeError('Failed to fetch'))).toBe('network-error');
  });

  it('maps the weak-password error, which is not an AuthApiError but carries the same code', () => {
    const error = new AuthWeakPasswordError('Password should be at least 6 characters.', 422, [
      'length',
    ]);

    expect(authFailureCodeOf(error)).toBe('weak-password');
  });

  it('maps a missing session to an expired one', () => {
    expect(authFailureCodeOf(new AuthSessionMissingError())).toBe('session-expired');
  });

  it('recognises a rate limit by status and an old-style wrong-password message', () => {
    expect(authFailureCodeOf(new AuthApiError('slow down', 429, undefined))).toBe('rate-limited');
    expect(authFailureCodeOf(new AuthApiError('Invalid login credentials', 400, undefined))).toBe(
      'invalid-credentials',
    );
  });

  it('does not guess about anything else', () => {
    expect(authFailureCodeOf(new AuthApiError('boom', 500, 'unexpected_failure'))).toBe('unknown');
    expect(authFailureCodeOf(new AuthUnknownError('x', new Error('y')))).toBe('unknown');
    expect(authFailureCodeOf(new Error('x'))).toBe('unknown');
    expect(authFailureCodeOf('text')).toBe('unknown');
    expect(authFailureCodeOf(null)).toBe('unknown');
  });
});

describe('authFailureMessage', () => {
  const codes: AuthFailureCode[] = [
    'invalid-credentials',
    'email-not-confirmed',
    'email-taken',
    'weak-password',
    'invalid-email',
    'rate-limited',
    'sign-up-disabled',
    'network-error',
    'session-expired',
    'unknown',
  ];

  it('has a Polish sentence for every code', () => {
    for (const code of codes) {
      expect(authFailureMessage(code), code).toMatch(/[.!]$/);
    }
  });

  it('does not say which of the e-mail and the password was wrong', () => {
    expect(authFailureMessage('invalid-credentials')).toBe('Nieprawidłowy adres e-mail lub hasło.');
  });

  it('says what to do about a network failure and an expired session', () => {
    expect(authFailureMessage('network-error')).toContain('połączenie');
    expect(authFailureMessage('session-expired')).toContain('Zaloguj się ponownie');
  });
});
