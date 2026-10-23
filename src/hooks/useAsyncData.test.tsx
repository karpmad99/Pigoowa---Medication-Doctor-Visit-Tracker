import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/queryClient';
import { RepositoryError } from '@/services/errors';
import { createDeferred } from '@/test/services';
import { useAsyncData } from './useAsyncData';

afterEach(() => {
  vi.restoreAllMocks();
});

// The data hooks run on TanStack Query: each test gets a query client of its own, made the way the app makes it.
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function StrictWrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <Wrapper>{children}</Wrapper>
    </StrictMode>
  );
}

describe('useAsyncData', () => {
  it('starts loading, then delivers the data', async () => {
    const load = () => Promise.resolve(['a', 'b']);

    const { result } = renderHook(() => useAsyncData(['test'], load), { wrapper: Wrapper });

    expect(result.current).toMatchObject({ isLoading: true, data: undefined, error: undefined });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current).toMatchObject({ data: ['a', 'b'], error: undefined });
  });

  it('reports a failure as an error, never as an empty successful result', async () => {
    const failure = new RepositoryError('data-corrupted', { detail: 'x' });
    const load = () => Promise.reject(failure);

    const { result } = renderHook(() => useAsyncData(['test'], load), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(failure);
  });

  it('wraps an unexpected failure in a RepositoryError so callers handle one error type', async () => {
    const load = () => Promise.reject(new TypeError('bug'));

    const { result } = renderHook(() => useAsyncData(['test'], load), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(RepositoryError);
    });
    expect(result.current.error?.code).toBe('unexpected');
  });

  it('turns a loader that throws immediately into an error state instead of crashing', async () => {
    const load = (): Promise<string> => {
      throw new Error('thrown at once');
    };

    const { result } = renderHook(() => useAsyncData(['test'], load), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.error?.code).toBe('unexpected');
    });
  });

  it('loads once, not on every render, while the key stays the same', async () => {
    const load = vi.fn(() => Promise.resolve('x'));

    const { result, rerender } = renderHook(() => useAsyncData(['test'], load), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    rerender();
    rerender();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reload() loads again, passing through the loading state', async () => {
    const second = createDeferred<string>();
    const answers = [Promise.resolve('answer 1'), second.promise];
    const load = vi.fn(() => answers.shift() ?? Promise.reject(new Error('unexpected')));
    const { result } = renderHook(() => useAsyncData(['test'], load), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.data).toBe('answer 1');
    });

    act(() => {
      result.current.reload();
    });

    // TanStack Query announces a state change a moment later, not inside the click.
    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });
    await act(async () => {
      second.resolve('answer 2');
      await second.promise;
    });
    await waitFor(() => {
      expect(result.current.data).toBe('answer 2');
    });
  });

  it('recovers from an error with reload()', async () => {
    let healthy = false;
    const load = () =>
      healthy ? Promise.resolve('ok') : Promise.reject(new RepositoryError('storage-unavailable'));
    const { result } = renderHook(() => useAsyncData(['test'], load), { wrapper: Wrapper });
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
    const { result, rerender } = renderHook(
      ({ id, load }: { id: string; load: () => Promise<string> }) =>
        useAsyncData(['test', id], load),
      { initialProps: { id: 'slow', load: () => slow.promise }, wrapper: Wrapper },
    );

    rerender({ id: 'fast', load: () => fast.promise });
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      fast.resolve('newer');
      await fast.promise;
    });
    await waitFor(() => {
      expect(result.current).toMatchObject({ isLoading: false, data: 'newer' });
    });
    await act(async () => {
      slow.resolve('older');
      await slow.promise;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current).toMatchObject({ isLoading: false, data: 'newer' });
  });

  it('ignores a late failure of a superseded request', async () => {
    const slow = createDeferred<string>();
    const fast = createDeferred<string>();
    const { result, rerender } = renderHook(
      ({ id, load }: { id: string; load: () => Promise<string> }) =>
        useAsyncData(['test', id], load),
      { initialProps: { id: 'slow', load: () => slow.promise }, wrapper: Wrapper },
    );

    rerender({ id: 'fast', load: () => fast.promise });
    await act(async () => {
      fast.resolve('fine');
      await fast.promise;
    });
    await waitFor(() => {
      expect(result.current.data).toBe('fine');
    });
    await act(async () => {
      slow.reject(new RepositoryError('storage-full'));
      await slow.promise.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current).toMatchObject({ data: 'fine', error: undefined });
  });

  it('does nothing when an answer arrives after the component has gone away', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = createDeferred<string>();
    const { unmount } = renderHook(() => useAsyncData(['test'], () => pending.promise), {
      wrapper: Wrapper,
    });

    unmount();
    await act(async () => {
      pending.resolve('too late');
      await pending.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('produces the right final state under React StrictMode, which runs effects twice in development', async () => {
    const load = vi.fn(() => Promise.resolve('x'));

    const { result } = renderHook(() => useAsyncData(['test'], load), { wrapper: StrictWrapper });

    await waitFor(() => {
      expect(result.current.data).toBe('x');
    });
    expect(result.current.error).toBeUndefined();
  });
});

describe('useAsyncData with keepDataOnReload', () => {
  it('is not refreshing while the first load runs, or once it is done', async () => {
    const load = () => Promise.resolve('a');
    const { result } = renderHook(() => useAsyncData(['test'], load, { keepDataOnReload: true }), {
      wrapper: Wrapper,
    });

    expect(result.current).toMatchObject({ isLoading: true, isRefreshing: false });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isRefreshing).toBe(false);
  });

  it('keeps showing the previous data while reload() fetches, then swaps in the new data', async () => {
    const second = createDeferred<string>();
    const answers = [Promise.resolve('first'), second.promise];
    const load = vi.fn(() => answers.shift() ?? Promise.reject(new Error('unexpected')));
    const { result } = renderHook(() => useAsyncData(['test'], load, { keepDataOnReload: true }), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.data).toBe('first');
    });

    act(() => {
      result.current.reload();
    });

    // No loading state in between: the old data stays, marked as being refreshed.
    await waitFor(() => {
      expect(result.current).toMatchObject({
        isLoading: false,
        data: 'first',
        error: undefined,
        isRefreshing: true,
      });
    });
    await act(async () => {
      second.resolve('second');
      await second.promise;
    });
    await waitFor(() => {
      expect(result.current).toMatchObject({ data: 'second', isRefreshing: false });
    });
  });

  it('turns a failed refresh into an error instead of presenting old data as current', async () => {
    const failure = new RepositoryError('storage-unavailable');
    const answers = [() => Promise.resolve('first'), () => Promise.reject(failure)];
    const load = vi.fn(() => answers.shift()?.() ?? Promise.reject(new Error('unexpected')));
    const { result } = renderHook(() => useAsyncData(['test'], load, { keepDataOnReload: true }), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.data).toBe('first');
    });

    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.error).toBe(failure);
    });
    expect(result.current).toMatchObject({ data: undefined, isRefreshing: false });
  });

  it('still starts at loading for a different request, never showing the other request’s data', async () => {
    const gateB = createDeferred<string>();
    const { result, rerender } = renderHook(
      ({ id, load }: { id: string; load: () => Promise<string> }) =>
        useAsyncData(['test', id], load, { keepDataOnReload: true }),
      { initialProps: { id: 'A', load: () => Promise.resolve('A') }, wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.data).toBe('A');
    });

    rerender({ id: 'B', load: () => gateB.promise });

    expect(result.current).toMatchObject({ isLoading: true, data: undefined, isRefreshing: false });
    await act(async () => {
      gateB.resolve('B');
      await gateB.promise;
    });
    await waitFor(() => {
      expect(result.current.data).toBe('B');
    });
  });

  it('without the option, reload() still goes back through loading', async () => {
    const answers = [Promise.resolve('first'), new Promise<string>(() => undefined)];
    const load = vi.fn(() => answers.shift() ?? Promise.reject(new Error('unexpected')));
    const { result } = renderHook(() => useAsyncData(['test'], load), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.data).toBe('first');
    });

    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({
        isLoading: true,
        data: undefined,
        isRefreshing: false,
      });
    });
  });
});
