import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClock, useServices } from '@/hooks/useServices';
import { createFixedClock } from '@/utils/clock';
import { createTestServices, servicesWrapper } from '@/test/services';
import { createLocalServices } from '@/services/local/createLocalServices';
import { createFakeStorage } from '@/test/fakeStorage';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ServicesProvider and its hooks', () => {
  it('gives components the services that were passed in', () => {
    const services = createTestServices();

    const { result } = renderHook(() => useServices(), { wrapper: servicesWrapper(services) });

    expect(result.current).toBe(services);
    expect(result.current.timeZone).toBe('Europe/Warsaw');
  });

  it('exposes the injected clock, so tests control "now" without touching global time', () => {
    const services = createLocalServices({
      storage: createFakeStorage(),
      clock: createFixedClock('2030-01-02T03:04:05Z'),
    });

    const { result } = renderHook(() => useClock(), { wrapper: servicesWrapper(services) });

    expect(result.current.now()).toBe('2030-01-02T03:04:05.000Z');
  });

  it('lets a replacement for any service be injected', async () => {
    const services = createTestServices();
    const replaced = {
      ...services,
      repositories: {
        ...services.repositories,
        medications: { ...services.repositories.medications, list: () => Promise.resolve([]) },
      },
    };

    const { result } = renderHook(() => useServices(), { wrapper: servicesWrapper(replaced) });

    expect(await result.current.repositories.medications.list()).toEqual([]);
    expect(result.current.repositories.appointments).toBe(services.repositories.appointments);
  });

  it('fails with a clear message when used outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // React logs the thrown error

    expect(() => renderHook(() => useServices())).toThrow('inside a <ServicesProvider>');
  });
});
