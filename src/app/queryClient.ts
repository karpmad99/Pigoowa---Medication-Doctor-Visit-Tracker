import { notifyManager, QueryClient } from '@tanstack/react-query';

// TanStack Query passes its state changes on in a separate timer task by default. The screens were written
// for answers delivered in the same task as they arrive (a moment less, and no frame between a request
// finishing and its screen), so changes are passed on as soon as the current work is done.
notifyManager.setScheduler((callback) => {
  queueMicrotask(callback);
});

/**
 * The query client of one set of services. Server state is cached per client, so a client must never
 * outlive the services (the account) it was made for: answers cannot cross from one account to the next.
 * Nothing is refetched by itself and nothing is kept after the last screen using it is gone, so the data
 * hooks behave as they always did: they load when they are shown and when the screen asks to reload.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}
