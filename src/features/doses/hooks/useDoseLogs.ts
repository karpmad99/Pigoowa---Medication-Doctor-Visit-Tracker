import { useCallback } from 'react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useServices } from '@/hooks/useServices';
import type { LocalDate } from '@/types/primitives';

/** Intake records whose scheduled date is in [from, to] (inclusive). A new range loads afresh. */
export function useDoseLogs(from: LocalDate, to: LocalDate) {
  const { repositories } = useServices();
  const load = useCallback(
    () => repositories.doseLogs.listByDateRange(from, to),
    [repositories, from, to],
  );
  return useAsyncData(load);
}
