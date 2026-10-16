import { describe, expect, it } from 'vitest';
import { isRollbackFailure, RepositoryError, toRepositoryError } from './errors';

describe('isRollbackFailure', () => {
  it('recognises the errors that say undoing a partial change failed too', () => {
    expect(
      isRollbackFailure(
        new RepositoryError('storage-full', {
          detail: 'rollback failed: data may be inconsistent',
        }),
      ),
    ).toBe(true);
    expect(
      isRollbackFailure(new RepositoryError('storage-full', { detail: 'rollback failed' })),
    ).toBe(true);
  });

  it('is false for a failure that was cleanly rolled back or never changed anything', () => {
    expect(isRollbackFailure(new RepositoryError('storage-full', { detail: 'rolled back' }))).toBe(
      false,
    );
    expect(isRollbackFailure(new RepositoryError('not-found'))).toBe(false);
  });
});

describe('toRepositoryError', () => {
  it('keeps a RepositoryError as it is and wraps anything else, remembering the cause', () => {
    const original = new RepositoryError('not-found');
    const surprise = new TypeError('bug');

    expect(toRepositoryError(original)).toBe(original);
    expect(toRepositoryError(surprise).code).toBe('unexpected');
    expect(toRepositoryError(surprise).cause).toBe(surprise);
  });
});
