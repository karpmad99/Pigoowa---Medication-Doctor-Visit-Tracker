import { useCallback, useEffect, useMemo, useState } from 'react';
import { RepositoryError, toRepositoryError } from '@/services/errors';

/**
 * The state of something being loaded: exactly one of loading, loaded, or failed. Because it is
 * a union, `data` is only a value when loading has succeeded, and a failure can never be
 * mistaken for an empty result.
 */
export type AsyncData<T> =
  | { isLoading: true; data: undefined; error: undefined }
  | { isLoading: false; data: T; error: undefined }
  | { isLoading: false; data: undefined; error: RepositoryError };

export type AsyncDataResult<T> = AsyncData<T> & {
  /** Loads again. The state goes back to loading until the new result arrives. */
  reload: () => void;
};

type Outcome<T> = { ok: true; data: T } | { ok: false; error: RepositoryError };

/**
 * Runs `load` and reports its state.
 *
 * - `load` must keep the same identity between renders (wrap it in `useCallback`); a new
 *   function means "a different request": the state returns to loading and the old request's
 *   answer is thrown away. An inline arrow function would therefore reload forever.
 * - Answers that arrive late are ignored: after the component unmounts, or after the request was
 *   replaced by a newer one, the old answer can no longer change the state.
 */
export function useAsyncData<T>(load: () => Promise<T>): AsyncDataResult<T> {
  const [version, setVersion] = useState(0);
  // A new object whenever the request changes. It labels the answer so we can tell whether an
  // answer belongs to the current request or an old one.
  const request = useMemo(() => ({ load, version }), [load, version]);
  const [settled, setSettled] = useState<{ request: object; outcome: Outcome<T> } | null>(null);

  useEffect(() => {
    let ignore = false;
    // Starting from a resolved promise also turns a `load` that throws at once into a rejection.
    Promise.resolve()
      .then(load)
      .then(
        (data) => {
          if (!ignore) setSettled({ request, outcome: { ok: true, data } });
        },
        (error: unknown) => {
          if (!ignore)
            setSettled({ request, outcome: { ok: false, error: toRepositoryError(error) } });
        },
      );
    return () => {
      ignore = true;
    };
  }, [request, load]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  if (settled?.request !== request) {
    return { isLoading: true, data: undefined, error: undefined, reload };
  }
  return settled.outcome.ok
    ? { isLoading: false, data: settled.outcome.data, error: undefined, reload }
    : { isLoading: false, data: undefined, error: settled.outcome.error, reload };
}
