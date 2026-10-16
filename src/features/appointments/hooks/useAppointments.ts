import { useCallback } from 'react';
import { useAsyncData, type AsyncDataOptions } from '@/hooks/useAsyncData';
import { useServices } from '@/hooks/useServices';

/** All appointments, with explicit loading and error states. */
export function useAppointments(options?: AsyncDataOptions) {
  const { repositories } = useServices();
  const load = useCallback(() => repositories.appointments.list(), [repositories]);
  return useAsyncData(load, options);
}
