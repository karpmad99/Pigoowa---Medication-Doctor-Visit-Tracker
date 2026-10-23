import { describe, expect, it } from 'vitest';
import { isRollbackFailure, RepositoryError } from '../errors';
import { assertOk, toRepositoryErrorFromResponse, unwrap, type RestResponse } from './responses';

function failed(
  status: number,
  code: string | undefined,
  message = 'text',
  details: string | null = null,
): RestResponse<unknown> {
  return {
    data: null,
    status,
    error: { message, ...(code === undefined ? {} : { code }), details },
  };
}

function codeOf(response: RestResponse<unknown>): string {
  return toRepositoryErrorFromResponse(response).code;
}

describe('how an answer from the REST API becomes a RepositoryError', () => {
  it('no answer at all (status 0) is a network failure', () => {
    expect(codeOf(failed(0, ''))).toBe('network-error');
    expect(codeOf(failed(0, undefined, 'TypeError: fetch failed'))).toBe('network-error');
  });

  it('a missing, expired or invalid token is "not signed in"', () => {
    expect(codeOf(failed(401, 'PGRST301', 'JWT expired'))).toBe('not-signed-in');
    expect(codeOf(failed(401, 'PGRST303'))).toBe('not-signed-in');
    // A request made with the anon role touching a table it has no privilege on.
    expect(codeOf(failed(401, '42501', 'permission denied for table medications'))).toBe(
      'not-signed-in',
    );
  });

  it('a refusal of a signed-in user (row level security) is "permission denied"', () => {
    expect(codeOf(failed(403, '42501', 'new row violates row-level security policy'))).toBe(
      'permission-denied',
    );
  });

  it('a unique violation names what it was: the slot, the id, or just an invalid value', () => {
    expect(
      codeOf(
        failed(
          409,
          '23505',
          'duplicate key value violates unique constraint "dose_logs_one_per_slot"',
        ),
      ),
    ).toBe('duplicate-slot');
    expect(
      codeOf(
        failed(409, '23505', 'duplicate key value violates unique constraint "medications_pkey"'),
      ),
    ).toBe('duplicate-id');
    expect(
      codeOf(
        failed(409, '23505', 'duplicate key value violates unique constraint "dose_logs_pkey"'),
      ),
    ).toBe('duplicate-id');
    expect(
      codeOf(failed(409, '23505', 'duplicate key ... "medication_schedule_times_one_per_time"')),
    ).toBe('invalid-input');
  });

  it('a foreign key violation is a missing reference', () => {
    expect(codeOf(failed(409, '23503'))).toBe('missing-reference');
  });

  it.each(['23502', '23514', '22001', '22003', '22007', '22008', '22P02'])(
    'the value-refusing Postgres code %s is invalid input',
    (code) => {
      expect(codeOf(failed(400, code))).toBe('invalid-input');
    },
  );

  it('no row where one was required is not-found; anything else is unexpected', () => {
    expect(codeOf(failed(406, 'PGRST116'))).toBe('not-found');
    expect(codeOf(failed(500, 'XX000'))).toBe('unexpected');
    expect(codeOf(failed(503, undefined))).toBe('unexpected');
  });

  it('never copies the server text, which can quote stored values, into the error', () => {
    const error = toRepositoryErrorFromResponse(
      failed(409, '23505', 'Key (name)=(Sekretny lek) already exists', 'Key (name)=(Sekretny lek)'),
    );

    expect(`${error.message} ${error.detail ?? ''}`).not.toContain('Sekretny');
  });

  it('unwrap returns the data and throws for a failure or an empty answer', () => {
    expect(unwrap({ data: [1], error: null, status: 200 })).toEqual([1]);
    expect(() => unwrap(failed(0, ''))).toThrow(RepositoryError);
    expect(() => unwrap({ data: null, error: null, status: 200 })).toThrow(RepositoryError);
  });

  it('assertOk only looks at the error', () => {
    expect(() => {
      assertOk({ data: null, error: null, status: 204 });
    }).not.toThrow();
    expect(() => {
      assertOk(failed(409, '23503'));
    }).toThrow(RepositoryError);
  });

  it('a rollback failure is recognised by its detail, as in the local repositories', () => {
    expect(
      isRollbackFailure(new RepositoryError('unexpected', { detail: 'rollback failed: x' })),
    ).toBe(true);
  });
});
