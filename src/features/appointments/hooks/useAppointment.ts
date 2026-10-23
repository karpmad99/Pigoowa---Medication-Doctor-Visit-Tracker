import { useCallback } from 'react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useServices } from '@/hooks/useServices';
import type { Id } from '@/types/primitives';

/** One appointment by id. An id that does not exist is reported as a `not-found` error, not as an empty result. */
export function useAppointment(id: Id) {
  const { repositories } = useServices();
  const load = useCallback(() => repositories.appointments.get(id), [repositories, id]);
  return useAsyncData(['appointment', id], load);
}
