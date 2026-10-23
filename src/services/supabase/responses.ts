import { RepositoryError } from '../errors';

// How an answer from the Supabase REST API becomes a RepositoryError. The UI decides what to do from the
// code alone (see ../errors.ts), so every failure the server or the network can produce is sorted here.
// Messages of the server are NOT copied into the error: they can quote stored values (a duplicate key
// message names the value), and a RepositoryError may be logged.

/** The part of a PostgREST answer this module reads. */
export interface RestResponse<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string | null } | null;
  /** 0 when the request never got an answer. */
  status: number;
  count?: number | null;
}

/** Postgres error codes that mean "the value was refused": a constraint, a type or a range. */
const INVALID_INPUT_CODES = new Set([
  '23502', // not null
  '23514', // check (also raised by the triggers of the schema)
  '22001', // string too long
  '22003', // numeric out of range
  '22007', // invalid datetime format
  '22008', // datetime field overflow
  '22P02', // invalid text representation (for example a malformed uuid)
  '23P01', // exclusion
]);

function constraintOf(error: { message: string; details?: string | null }): string {
  return `${error.message} ${error.details ?? ''}`;
}

export function toRepositoryErrorFromResponse(response: RestResponse<unknown>): RepositoryError {
  const { error, status } = response;
  if (error === null) return new RepositoryError('unexpected', { detail: 'no error in response' });
  const code = error.code ?? '';
  const detail = code === '' ? `http ${String(status)}` : `postgres ${code}`;

  // fetch failed before any answer: the browser is offline, the server is down, or the request was blocked.
  if (status === 0) return new RepositoryError('network-error', { detail });
  // No valid session. PostgREST answers 401 for a missing, expired or invalid token (PGRST30x), and also
  // for a request made with the anon role that touches a table it has no privilege on (42501).
  if (status === 401 || code.startsWith('PGRST30')) {
    return new RepositoryError('not-signed-in', { detail });
  }
  if (code === '42501') return new RepositoryError('permission-denied', { detail });

  const text = constraintOf(error);
  if (code === '23505') {
    if (text.includes('dose_logs_one_per_slot')) {
      return new RepositoryError('duplicate-slot', { detail });
    }
    if (text.includes('_pkey')) return new RepositoryError('duplicate-id', { detail });
    return new RepositoryError('invalid-input', { detail });
  }
  if (code === '23503') return new RepositoryError('missing-reference', { detail });
  if (INVALID_INPUT_CODES.has(code)) return new RepositoryError('invalid-input', { detail });
  if (code === 'PGRST116') return new RepositoryError('not-found', { detail });
  return new RepositoryError('unexpected', { detail });
}

/** The data of a successful answer; a failed one throws the matching RepositoryError. */
export function unwrap<T>(response: RestResponse<T>): T {
  if (response.error !== null) throw toRepositoryErrorFromResponse(response);
  if (response.data === null) {
    throw new RepositoryError('unexpected', { detail: 'empty response' });
  }
  return response.data;
}

/** For writes whose answer carries no rows we need (a delete without `select`). */
export function assertOk(response: RestResponse<unknown>): void {
  if (response.error !== null) throw toRepositoryErrorFromResponse(response);
}
