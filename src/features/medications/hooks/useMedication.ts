import { useCallback } from 'react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useServices } from '@/hooks/useServices';
import type { Id } from '@/types/primitives';

/** One medication by id. A medication that does not exist is an error (`not-found`), not an empty result. */
export function useMedication(id: Id) {
  const { repositories } = useServices();
  const load = useCallback(() => repositories.medications.get(id), [repositories, id]);
  return useAsyncData(['medication', id], load);
}
