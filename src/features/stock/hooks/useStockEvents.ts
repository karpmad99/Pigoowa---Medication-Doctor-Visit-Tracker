import { useCallback } from 'react';
import { useAsyncData, type AsyncDataOptions } from '@/hooks/useAsyncData';
import { useServices } from '@/hooks/useServices';

/** Every stock event (refills, waste), once: the estimates and the history are computed from this one answer. */
export function useStockEvents(options?: AsyncDataOptions) {
  const { repositories } = useServices();
  const load = useCallback(() => repositories.stockEvents.list(), [repositories]);
  return useAsyncData(['stockEvents'], load, options);
}
