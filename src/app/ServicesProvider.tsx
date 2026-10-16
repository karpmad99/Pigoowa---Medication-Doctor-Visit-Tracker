import type { ReactNode } from 'react';
import type { AppServices } from '@/services/repositories';
import { ServicesContext } from './servicesContext';

/**
 * Makes the clock, time zone, id generator and repositories available to every component below.
 * The services are created once, at the top (src/main.tsx), and passed in here. Tests pass
 * their own, so nothing needs to be mocked globally. `services` should keep the same identity
 * for the lifetime of the app: the data hooks reload when it changes.
 */
export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}
