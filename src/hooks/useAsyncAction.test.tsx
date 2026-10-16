import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '@/services/errors';
import { createDeferred } from '@/test/services';
import { useAsyncAction } from './useAsyncAction';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAsyncAction', () => {
  it('runs the task and reports its result', async () => {
    const { result } = renderHook(() => useAsyncAction());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run(() => Promise.resolve('done'));
    });

    expect(outcome).toEqual({ status: 'success', value: 'done' });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('is running while the task is pending', async () => {
    const pending = createDeferred<string>();
    const { result } = renderHook(() => useAsyncAction());

    act(() => {
      void result.current.run(() => pending.promise);
    });
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      pending.resolve('x');
      await pending.promise;
    });
    expect(result.current.isRunning).toBe(false);
  });

  it('ignores a second run while one is in progress, so a double click writes only once', async () => {
    const pending = createDeferred<string>();
    const task = vi.fn(() => pending.promise);
    const { result } = renderHook(() => useAsyncAction());

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = result.current.run(task);
      // Immediately, in the same tick, before React has re-rendered:
      second = await result.current.run(task);
    });
    await act(async () => {
      pending.resolve('x');
      await first;
    });

    expect(second).toEqual({ status: 'ignored' });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('can run again after the previous run has finished', async () => {
    const task = vi.fn(() => Promise.resolve('x'));
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.run(task);
    });
    await act(async () => {
      await result.current.run(task);
    });

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('keeps a failure as an error and returns it, and the next run clears it', async () => {
    const failure = new RepositoryError('storage-full');
    const { result } = renderHook(() => useAsyncAction());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run(() => Promise.reject(failure));
    });
    expect(outcome).toEqual({ status: 'failed', error: failure });
    expect(result.current.error).toBe(failure);
    expect(result.current.isRunning).toBe(false);

    await act(async () => {
      await result.current.run(() => Promise.resolve('fine'));
    });
    expect(result.current.error).toBeNull();
  });

  it('wraps unexpected failures, including a task that throws at once', async () => {
    const { result } = renderHook(() => useAsyncAction());

    let outcome: Awaited<ReturnType<typeof result.current.run<string>>> | undefined;
    await act(async () => {
      outcome = await result.current.run<string>(() => {
        throw new TypeError('bug');
      });
    });

    expect(outcome?.status).toBe('failed');
    expect(result.current.error).toBeInstanceOf(RepositoryError);
    expect(result.current.error?.code).toBe('unexpected');
  });

  it('can clear the error by hand', async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new RepositoryError('storage-full')));
    });

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('does not touch state, or warn, when the component is gone before the task finishes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = createDeferred<string>();
    const { result, unmount } = renderHook(() => useAsyncAction());
    let running: Promise<unknown> = Promise.resolve();
    act(() => {
      running = result.current.run(() => pending.promise);
    });

    unmount();
    await act(async () => {
      pending.reject(new RepositoryError('storage-full'));
      await running;
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('still reports the outcome to the caller after unmount', async () => {
    const pending = createDeferred<string>();
    const { result, unmount } = renderHook(() => useAsyncAction());
    let running: Promise<unknown> = Promise.resolve();
    act(() => {
      running = result.current.run(() => pending.promise);
    });
    unmount();

    pending.resolve('saved');

    await waitFor(async () => {
      expect(await running).toEqual({ status: 'success', value: 'saved' });
    });
  });

  describe('with blockAfterSuccess', () => {
    it('refuses to run again after a success, so a saved form cannot be saved twice', async () => {
      const task = vi.fn(() => Promise.resolve('saved'));
      const { result } = renderHook(() => useAsyncAction({ blockAfterSuccess: true }));

      let first: unknown;
      let second: unknown;
      await act(async () => {
        first = await result.current.run(task);
      });
      await act(async () => {
        second = await result.current.run(task);
      });

      expect(first).toEqual({ status: 'success', value: 'saved' });
      expect(second).toEqual({ status: 'ignored' });
      expect(task).toHaveBeenCalledTimes(1);
    });

    it('still lets the user try again after a FAILURE', async () => {
      let attempts = 0;
      const task = vi.fn(() =>
        ++attempts === 1
          ? Promise.reject(new RepositoryError('storage-full'))
          : Promise.resolve('ok'),
      );
      const { result } = renderHook(() => useAsyncAction({ blockAfterSuccess: true }));

      await act(async () => {
        await result.current.run(task);
      });
      let second: unknown;
      await act(async () => {
        second = await result.current.run(task);
      });

      expect(second).toEqual({ status: 'success', value: 'ok' });
      expect(task).toHaveBeenCalledTimes(2);
    });

    it('is off by default: a second run after a success runs normally', async () => {
      const task = vi.fn(() => Promise.resolve('x'));
      const { result } = renderHook(() => useAsyncAction());

      await act(async () => {
        await result.current.run(task);
      });
      await act(async () => {
        await result.current.run(task);
      });

      expect(task).toHaveBeenCalledTimes(2);
    });
  });
});
