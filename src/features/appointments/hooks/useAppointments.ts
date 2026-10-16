import { useCallback } from 'react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useServices } from '@/hooks/useServices';

/** All appointments, with explicit loading and error states. */
export function useAppointments() {
  const { repositories } = useServices();
  const load = useCallback(() => repositories.appointments.list(), [repositories]);
  return useAsyncData(load);
}
