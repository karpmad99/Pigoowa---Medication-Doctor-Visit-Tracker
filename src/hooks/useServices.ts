import { useContext } from 'react';
import { ServicesContext } from '@/app/servicesContext';
import type { AppServices } from '@/services/repositories';
import type { Clock } from '@/utils/clock';

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error('useServices must be used inside a <ServicesProvider>');
  }
  return services;
}

export function useClock(): Clock {
  return useServices().clock;
}
