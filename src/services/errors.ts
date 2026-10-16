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

/** Turns anything that was thrown into a RepositoryError, so callers can rely on one error type. */
export function toRepositoryError(error: unknown): RepositoryError {
  return error instanceof RepositoryError
    ? error
    : new RepositoryError('unexpected', { cause: error });
}
