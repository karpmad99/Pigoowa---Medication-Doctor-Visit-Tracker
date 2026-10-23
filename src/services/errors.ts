/** Why a repository operation failed. The UI decides what to do from this code. */
export type RepositoryErrorCode =
  /** The browser storage cannot be reached (disabled, blocked, or throwing). */
  | 'storage-unavailable'
  /** The storage is full. */
  | 'storage-full'
  /** Writing failed for another reason (e.g. a security restriction). Nothing was changed. */
  | 'storage-write-failed'
  /** Stored data is not valid JSON, or does not match the expected shape. It is left untouched. */
  | 'data-corrupted'
  /** Stored data was written by a different, unknown version of the application. Left untouched. */
  | 'unsupported-version'
  | 'not-found'
  /** A record with this id already exists. */
  | 'duplicate-id'
  /** Another record already occupies this dose slot (medication, date and time). */
  | 'duplicate-slot'
  /** The record refers to a medication that does not exist. */
  | 'missing-reference'
  /** The record fails validation, so it was not stored. */
  | 'invalid-input'
  /** Demo data can only be loaded into empty storage. */
  | 'demo-data-not-empty'
  /** Demo data is for the demonstration version only; an account's data is never filled or replaced with it. */
  | 'demo-data-unavailable'
  /** The stored data still has the old format and has not been migrated yet, so nothing may be written to it. */
  | 'migration-required'
  /** The server could not be reached (no network, a blocked request, a stopped server). Nothing was changed. */
  | 'network-error'
  /** There is no signed-in user, or the session is no longer valid. Nothing was changed. */
  | 'not-signed-in'
  /** The server refused the operation for this user (row level security). Nothing was changed. */
  | 'permission-denied'
  /** Something unexpected went wrong (a bug, not a data problem). */
  | 'unexpected';

// User-facing text (Polish). It never contains medication names, doses or other stored values.
const messages: Record<RepositoryErrorCode, string> = {
  'storage-unavailable': 'Nie można uzyskać dostępu do pamięci przeglądarki.',
  'storage-full': 'W pamięci przeglądarki brakuje miejsca. Zmiany nie zostały zapisane.',
  'storage-write-failed':
    'Nie udało się zapisać danych w przeglądarce. Zmiany nie zostały zapisane.',
  'data-corrupted':
    'Zapisane dane są uszkodzone i nie można ich odczytać. Nic nie zostało zmienione.',
  'unsupported-version':
    'Zapisane dane pochodzą z innej wersji aplikacji i nie można ich odczytać. Nic nie zostało zmienione.',
  'not-found': 'Nie znaleziono takiego rekordu.',
  'duplicate-id': 'Rekord o tym identyfikatorze już istnieje.',
  'duplicate-slot': 'Dla tej dawki istnieje już inny zapis.',
  'missing-reference': 'Rekord odwołuje się do leku, który nie istnieje.',
  'invalid-input': 'Dane są nieprawidłowe i nie zostały zapisane.',
  'demo-data-not-empty': 'Dane demonstracyjne można wczytać tylko do pustej pamięci.',
  'demo-data-unavailable':
    'Dane demonstracyjne są dostępne tylko w trybie demo. Dane konta nigdy nie są nimi zastępowane.',
  'migration-required':
    'Zapisane dane nie zostały jeszcze zaktualizowane do nowego formatu, więc zmiany nie zostały zapisane. Odśwież stronę i spróbuj ponownie.',
  'network-error':
    'Nie można połączyć się z serwerem. Sprawdź połączenie z internetem i spróbuj ponownie. Zmiany nie zostały zapisane.',
  'not-signed-in': 'Sesja wygasła lub nie jesteś zalogowany. Zaloguj się ponownie.',
  'permission-denied': 'Serwer odmówił wykonania tej operacji. Zmiany nie zostały zapisane.',
  unexpected: 'Wystąpił nieoczekiwany błąd.',
};

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  /**
   * Technical hint for developers, e.g. the path of an invalid field. Written in English and
   * never contains stored values, so it is safe to log.
   */
  readonly detail: string | undefined;

  constructor(code: RepositoryErrorCode, options: { detail?: string; cause?: unknown } = {}) {
    super(messages[code], { cause: options.cause });
    this.name = 'RepositoryError';
    this.code = code;
    this.detail = options.detail;
  }
}

/**
 * True when an operation failed AND the attempt to undo its partial effects failed too, so the
 * stored data may be inconsistent (for example a medication deleted but its history still
 * there). Callers should say so plainly rather than treat it as an ordinary failed write.
 */
export function isRollbackFailure(error: RepositoryError): boolean {
  return error.detail?.startsWith('rollback failed') ?? false;
}

/** Turns anything that was thrown into a RepositoryError, so callers can rely on one error type. */
export function toRepositoryError(error: unknown): RepositoryError {
  return error instanceof RepositoryError
    ? error
    : new RepositoryError('unexpected', { cause: error });
}
