import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import { useDoseLogs } from '@/features/doses/hooks/useDoseLogs';
import { useMedication } from '@/features/medications/hooks/useMedication';
import { useMedications } from '@/features/medications/hooks/useMedications';
import { STORAGE_KEYS } from '@/services/local/collections';
import { asLocalDate } from '@/utils/date';
import { makeAppointment, makeDoseLog, makeMedication } from '@/test/fixtures';
import { createTestServices, servicesWrapper } from '@/test/services';

const DAY = asLocalDate('2026-10-15');

describe('useMedications', () => {
  it('loads from the repository: loading first, then an empty list for empty storage', async () => {
    const services = createTestServices();

    const { result } = renderHook(() => useMedications(), { wrapper: servicesWrapper(services) });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeUndefined();
  });

  it('shows stored medications, and picks up changes on reload', async () => {
    const services = createTestServices();
    await services.repositories.medications.create(makeMedication({ id: 'm-1', name: 'Lek A' }));
    const { result } = renderHook(() => useMedications(), { wrapper: servicesWrapper(services) });
    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
    });

    await services.repositories.medications.create(makeMedication({ id: 'm-2', name: 'Lek B' }));
    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.data?.map((medication) => medication.name)).toEqual(['Lek A', 'Lek B']);
    });
  });

  it('reports corrupted stored data as an error, without hiding it behind an empty list', async () => {
    const services = createTestServices();
    services.storage.data.set(STORAGE_KEYS.medications, '{broken');

    const { result } = renderHook(() => useMedications(), { wrapper: servicesWrapper(services) });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.code).toBe('data-corrupted');
    expect(services.storage.data.get(STORAGE_KEYS.medications)).toBe('{broken');
  });

  it('reports unavailable storage, and recovers once it is back', async () => {
    const services = createTestServices();
    services.storage.failReads();
    const { result } = renderHook(() => useMedications(), { wrapper: servicesWrapper(services) });
    await waitFor(() => {
      expect(result.current.error?.code).toBe('storage-unavailable');
    });

    services.storage.heal();
    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
  });
});

describe('useDoseLogs', () => {
  it('loads the records of the requested range only', async () => {
    const services = createTestServices();
    await services.repositories.medications.create(makeMedication({ id: 'med-1' }));
    await services.repositories.doseLogs.upsert(makeDoseLog({ id: 'l-in', scheduledDate: DAY }));
    await services.repositories.doseLogs.upsert(
      makeDoseLog({ id: 'l-out', scheduledDate: asLocalDate('2026-10-20') }),
    );

    const { result } = renderHook(() => useDoseLogs(DAY, DAY), {
      wrapper: servicesWrapper(services),
    });

    await waitFor(() => {
      expect(result.current.data?.map((log) => log.id)).toEqual(['l-in']);
    });
  });

  it('loads afresh when the range changes, going back to loading instead of showing the old range', async () => {
    const services = createTestServices();
    await services.repositories.medications.create(makeMedication({ id: 'med-1' }));
    await services.repositories.doseLogs.upsert(makeDoseLog({ id: 'l-15', scheduledDate: DAY }));
    await services.repositories.doseLogs.upsert(
      makeDoseLog({ id: 'l-16', scheduledDate: asLocalDate('2026-10-16') }),
    );
    const { result, rerender } = renderHook(({ day }) => useDoseLogs(day, day), {
      wrapper: servicesWrapper(services),
      initialProps: { day: DAY },
    });
    await waitFor(() => {
      expect(result.current.data?.map((log) => log.id)).toEqual(['l-15']);
    });

    rerender({ day: asLocalDate('2026-10-16') });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => {
      expect(result.current.data?.map((log) => log.id)).toEqual(['l-16']);
    });
  });

  it('reports an invalid range as an error', async () => {
    const services = createTestServices();

    const { result } = renderHook(() => useDoseLogs(asLocalDate('2026-10-16'), DAY), {
      wrapper: servicesWrapper(services),
    });

    await waitFor(() => {
      expect(result.current.error?.code).toBe('invalid-input');
    });
  });
});

describe('useAppointments', () => {
  it('loads appointments in order', async () => {
    const services = createTestServices();
    await services.repositories.appointments.create(makeAppointment({ id: 'a-1' }));

    const { result } = renderHook(() => useAppointments(), { wrapper: servicesWrapper(services) });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
    });
  });

  it('reports a failure as an error', async () => {
    const services = createTestServices();
    services.storage.data.set(STORAGE_KEYS.appointments, 'nonsense');

    const { result } = renderHook(() => useAppointments(), { wrapper: servicesWrapper(services) });

    await waitFor(() => {
      expect(result.current.error?.code).toBe('data-corrupted');
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe('useMedication', () => {
  it('loads one medication by id', async () => {
    const services = createTestServices();
    await services.repositories.medications.create(makeMedication({ id: 'm-1', name: 'Lek A' }));

    const { result } = renderHook(() => useMedication('m-1'), {
      wrapper: servicesWrapper(services),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.data?.name).toBe('Lek A');
    });
  });

  it('reports a medication that does not exist as a not-found error, not as an empty result', async () => {
    const services = createTestServices();

    const { result } = renderHook(() => useMedication('ghost'), {
      wrapper: servicesWrapper(services),
    });

    await waitFor(() => {
      expect(result.current.error?.code).toBe('not-found');
    });
    expect(result.current.data).toBeUndefined();
  });

  it('loads the other medication when the id changes', async () => {
    const services = createTestServices();
    await services.repositories.medications.create(makeMedication({ id: 'm-1', name: 'Pierwszy' }));
    await services.repositories.medications.create(makeMedication({ id: 'm-2', name: 'Drugi' }));
    const { result, rerender } = renderHook(({ id }) => useMedication(id), {
      wrapper: servicesWrapper(services),
      initialProps: { id: 'm-1' },
    });
    await waitFor(() => {
      expect(result.current.data?.name).toBe('Pierwszy');
    });

    rerender({ id: 'm-2' });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.data?.name).toBe('Drugi');
    });
  });
});
