import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import type { AppServices } from '@/services/repositories';
import { createQueryClient } from './queryClient';
import { ServicesContext } from './servicesContext';

/**
 * Makes the clock, time zone, id generator and repositories available to every component below,
 * together with the query client that holds their data. The services are created once, at the top
 * (src/main.tsx, or per account in src/app/SessionServices.tsx), and passed in here. Tests pass
 * their own, so nothing needs to be mocked globally. `services` should keep the same identity
 * for the lifetime of the app (or of the account): a different one starts with an empty cache.
 */
export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new client per services object, on purpose
  const queryClient = useMemo(() => createQueryClient(), [services]);
  useEffect(
    () => () => {
      queryClient.clear();
    },
    [queryClient],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ServicesContext value={services}>{children}</ServicesContext>
    </QueryClientProvider>
  );
}
