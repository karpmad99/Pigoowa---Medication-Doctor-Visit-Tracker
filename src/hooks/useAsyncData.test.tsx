import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '@/services/errors';
import { createDeferred } from '@/test/services';
import { useAsyncData } from './useAsyncData';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAsyncData', () => {
  it('starts loading, then delivers the data', async () => {
    const load = () => Promise.resolve(['a', 'b']);

    const { result } = renderHook(() => useAsyncData(load));

    expect(result.current).toMatchObject({ isLoading: true, data: undefined, error: undefined });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current).toMatchObject({ data: ['a', 'b'], error: undefined });
  });

  it('reports a failure as an error, never as an empty successful result', async () => {
    const failure = new RepositoryError('data-corrupted', { detail: 'x' });
    const load = () => Promise.reject(failure);

    const { result } = renderHook(() => useAsyncData(load));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(failure);
  });

  it('wraps an unexpected failure in a RepositoryError so callers handle one error type', async () => {
    const load = () => Promise.reject(new TypeError('bug'));

    const { result } = renderHook(() => useAsyncData(load));

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(RepositoryError);
    });
    expect(result.current.error?.code).toBe('unexpected');
  });

  it('turns a loader that throws immediately into an error state instead of crashing', async () => {
    const load = (): Promise<string> => {
      throw new Error('thrown at once');
    };

    const { result } = renderHook(() => useAsyncData(load));

    await waitFor(() => {
      expect(result.current.error?.code).toBe('unexpected');
    });
  });

  it('loads once, not on every render, when the loader keeps its identity', async () => {
    const load = vi.fn(() => Promise.resolve('x'));

    const { result, rerender } = renderHook(() => useAsyncData(load));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    rerender();
    rerender();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reload() loads again, passing through the loading state', async () => {
    let calls = 0;
    const load = () => Promise.resolve(`answer ${String((calls += 1))}`);
    const { result } = renderHook(() => useAsyncData(load));
    await waitFor(() => {
      expect(result.current.data).toBe('answer 1');
    });

    act(() => {
      result.current.reload();
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.data).toBe('answer 2');
    });
  });

  it('recovers from an error with reload()', async () => {
    let healthy = false;
    const load = () =>
      healthy ? Promise.resolve('ok') : Promise.reject(new RepositoryError('storage-unavailable'));
    const { result } = renderHook(() => useAsyncData(load));
    await waitFor(() => {
      expect(result.current.error?.code).toBe('storage-unavailable');
    });

    healthy = true;
    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.data).toBe('ok');
    });
    expect(result.current.error).toBeUndefined();
  });

  it('ignores an old answer that arrives after a newer request, whatever order they finish in', async () => {
    const slow = createDeferred<string>();
    const fast = createDeferred<string>();
    const { result, rerender } = renderHook(({ load }) => useAsyncData(load), {
      initialProps: { load: () => slow.promise },
    });

    rerender({ load: () => fast.promise });
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      fast.resolve('newer');
      await fast.promise;
    });
    await act(async () => {
      slow.resolve('older');
      await slow.promise;
    });

    expect(result.current).toMatchObject({ isLoading: false, data: 'newer' });
  });

  it('ignores a late failure of a superseded request', async () => {
    const slow = createDeferred<string>();
    const fast = createDeferred<string>();
    const { result, rerender } = renderHook(({ load }) => useAsyncData(load), {
      initialProps: { load: () => slow.promise },
    });

    rerender({ load: () => fast.promise });
    await act(async () => {
      fast.resolve('fine');
      await fast.promise;
    });
    await act(async () => {
      slow.reject(new RepositoryError('storage-full'));
      await slow.promise.catch(() => undefined);
    });

    expect(result.current).toMatchObject({ data: 'fine', error: undefined });
  });

  it('does nothing when an answer arrives after the component has gone away', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = createDeferred<string>();
    const { unmount } = renderHook(() => useAsyncData(() => pending.promise));

    unmount();
    await act(async () => {
      pending.resolve('too late');
      await pending.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('produces the right final state under React StrictMode, which runs effects twice in development', async () => {
    const load = vi.fn(() => Promise.resolve('x'));

    const { result } = renderHook(() => useAsyncData(load), { wrapper: StrictMode });

    await waitFor(() => {
      expect(result.current.data).toBe('x');
    });
    expect(result.current.error).toBeUndefined();
  });
});
