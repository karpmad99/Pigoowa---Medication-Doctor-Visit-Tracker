import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
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
  /**
   * Loads again. By default the state goes back to loading until the new result arrives; with
   * `keepDataOnReload` the previous data stays in place meanwhile (see `isRefreshing`).
   */
  reload: () => void;
  /**
   * True only while a `reload` is in flight and the data shown is still the previous answer
   * (requires `keepDataOnReload`). Always false otherwise.
   */
  isRefreshing: boolean;
};

export interface AsyncDataOptions {
  /**
   * Keep showing the last successful data while `reload` fetches fresh data, instead of going
   * back to loading. For screens that refresh after a small write, where a spinner replacing the
   * whole list would be a flicker. A failed refresh still becomes an error (never stale data
   * presented as current), and a different request (a different key) always starts at loading.
   */
  keepDataOnReload?: boolean;
}

/**
 * Loads server state with TanStack Query (PROJECT_SPEC DEC-12) and reports it as the union above.
 * The shape is the one the components have always had; only what is behind it changed.
 *
 * - `key` names the request. It must contain everything the request depends on (an id, a date
 *   range). A different key is a different request: the state returns to loading and the old
 *   request's answer can no longer reach this screen. The user's account is not part of the key:
 *   every account gets its own query client (see ServicesProvider), so answers never cross accounts.
 * - Nothing is refetched by itself (no refetch on focus, reconnect or mount, no retries, and nothing
 *   is kept after the last screen using it is gone): data changes only when the screen reloads it,
 *   as before. A failed answer is shown as a failure, never as an empty list.
 */
export function useAsyncData<T>(
  key: readonly unknown[],
  load: () => Promise<T>,
  { keepDataOnReload = false }: AsyncDataOptions = {},
): AsyncDataResult<T> {
  const queryClient = useQueryClient();
  const query = useQuery<T, RepositoryError>({
    queryKey: key,
    queryFn: async () => {
      try {
        return await load();
      } catch (error) {
        throw toRepositoryError(error);
      }
    },
  });

  const keyText = JSON.stringify(key);
  const { refetch } = query;
  const reload = useCallback(() => {
    if (keepDataOnReload) {
      void refetch();
    } else {
      // Back to the initial state (loading), then fetch again.
      void queryClient.resetQueries({ queryKey: JSON.parse(keyText) as unknown[], exact: true });
    }
  }, [keepDataOnReload, refetch, queryClient, keyText]);

  if (query.status === 'error') {
    return {
      isLoading: false,
      data: undefined,
      error: query.error,
      reload,
      isRefreshing: false,
    };
  }
  if (query.status === 'success') {
    return {
      isLoading: false,
      data: query.data,
      error: undefined,
      reload,
      isRefreshing: keepDataOnReload && query.isFetching,
    };
  }
  return { isLoading: true, data: undefined, error: undefined, reload, isRefreshing: false };
}
