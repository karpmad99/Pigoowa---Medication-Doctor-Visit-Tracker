import { AuthError, isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthFailureCode } from './types';

// Sorts what supabase-js reports into the application's own failure codes. The messages of the server are
// not shown or kept (they can name the e-mail address); only the code is used.

const BY_ERROR_CODE: Record<string, AuthFailureCode> = {
  invalid_credentials: 'invalid-credentials',
  email_not_confirmed: 'email-not-confirmed',
  user_already_exists: 'email-taken',
  email_exists: 'email-taken',
  weak_password: 'weak-password',
  email_address_invalid: 'invalid-email',
  validation_failed: 'invalid-email',
  over_request_rate_limit: 'rate-limited',
  over_email_send_rate_limit: 'rate-limited',
  over_sms_send_rate_limit: 'rate-limited',
  signup_disabled: 'sign-up-disabled',
  email_provider_disabled: 'sign-up-disabled',
  refresh_token_not_found: 'session-expired',
  refresh_token_already_used: 'session-expired',
  session_expired: 'session-expired',
  session_not_found: 'session-expired',
  bad_jwt: 'session-expired',
  user_not_found: 'session-expired',
};

export function authFailureCodeOf(error: unknown): AuthFailureCode {
  // No answer at all: offline, the server is down, or the request was blocked.
  if (isAuthRetryableFetchError(error)) return 'network-error';
  if (error instanceof AuthError) {
    // AuthApiError, AuthWeakPasswordError, AuthSessionMissingError… all carry the server's code.
    const mapped = error.code === undefined ? undefined : BY_ERROR_CODE[error.code];
    if (mapped !== undefined) return mapped;
    if (error.name === 'AuthSessionMissingError') return 'session-expired';
    if (isAuthApiError(error)) {
      if (error.status === 429) return 'rate-limited';
      // Older servers answer with a message only.
      if (/invalid login credentials/i.test(error.message)) return 'invalid-credentials';
    }
    return 'unknown';
  }
  // fetch itself threw (a browser that reports a failed request as a TypeError).
  if (error instanceof TypeError) return 'network-error';
  return 'unknown';
}

const messages: Record<AuthFailureCode, string> = {
  'invalid-credentials': 'Nieprawidłowy adres e-mail lub hasło.',
  'email-not-confirmed':
    'Adres e-mail nie został jeszcze potwierdzony. Kliknij link z wiadomości, którą wysłaliśmy po rejestracji.',
  'email-taken': 'Konto z tym adresem e-mail już istnieje. Zaloguj się albo użyj innego adresu.',
  'weak-password':
    'Hasło jest zbyt słabe. Użyj dłuższego hasła, najlepiej z cyframi i znakami specjalnymi.',
  'invalid-email': 'Ten adres e-mail jest nieprawidłowy.',
  'rate-limited': 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.',
  'sign-up-disabled': 'Rejestracja nowych kont jest teraz wyłączona.',
  'network-error':
    'Nie można połączyć się z serwerem. Sprawdź połączenie z internetem i spróbuj ponownie.',
  'session-expired': 'Sesja wygasła. Zaloguj się ponownie.',
  unknown: 'Nie udało się wykonać operacji. Spróbuj ponownie za chwilę.',
};

/** The Polish text for a failure. It never contains the e-mail address or anything else typed by the user. */
export function authFailureMessage(code: AuthFailureCode): string {
  return messages[code];
}
