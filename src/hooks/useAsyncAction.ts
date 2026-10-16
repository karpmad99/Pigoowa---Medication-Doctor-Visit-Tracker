import { useCallback, useEffect, useRef, useState } from 'react';
import { RepositoryError, toRepositoryError } from '@/services/errors';

export type ActionOutcome<T> =
  | { status: 'success'; value: T }
  | { status: 'failed'; error: RepositoryError }
  /** Another run was still in progress, so this one did not start. */
  | { status: 'ignored' };

/**
 * Runs one write at a time (saving a form, ending or deleting a medication).
 *
 * - A second `run` while one is in progress is ignored, not queued: a double click or a quick
 *   second submit can never write twice. The ref makes this immediate, before React re-renders.
 * - With `blockAfterSuccess`, once a run has succeeded no further run starts. A form that has been
 *   saved must not be saved again by a second submit that was already on its way (a double click
 *   whose second half only reaches the handler after the first save has finished).
 * - A failure is kept in `error` and returned, never swallowed, and the next run clears it.
 * - After the component is gone, nothing is set, so no stale update or warning follows.
 * The caller decides what success means (navigate, refresh a list), using the returned outcome.
 */
export function useAsyncAction({
  blockAfterSuccess = false,
}: { blockAfterSuccess?: boolean } = {}) {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<RepositoryError | null>(null);
  const runningRef = useRef(false);
  const succeededRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async <T>(task: () => Promise<T>): Promise<ActionOutcome<T>> => {
      if (runningRef.current || (blockAfterSuccess && succeededRef.current)) {
        return { status: 'ignored' };
      }
      runningRef.current = true;
      if (mountedRef.current) {
        setIsRunning(true);
        setError(null);
      }
      try {
        const value = await task();
        succeededRef.current = true;
        return { status: 'success', value };
      } catch (caught) {
        const failure = toRepositoryError(caught);
        if (mountedRef.current) setError(failure);
        return { status: 'failed', error: failure };
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setIsRunning(false);
      }
    },
    [blockAfterSuccess],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { run, isRunning, error, clearError };
}
