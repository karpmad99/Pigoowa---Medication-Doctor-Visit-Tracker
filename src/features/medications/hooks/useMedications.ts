import { useCallback } from 'react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useServices } from '@/hooks/useServices';

/** All medications, with explicit loading and error states. */
export function useMedications() {
  const { repositories } = useServices();
  const load = useCallback(() => repositories.medications.list(), [repositories]);
  return useAsyncData(load);
}
