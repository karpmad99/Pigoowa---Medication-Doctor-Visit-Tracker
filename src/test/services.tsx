import type { ReactNode } from 'react';
import { ServicesProvider } from '@/app/ServicesProvider';
import { createLocalServices } from '@/services/local/createLocalServices';
import type { AppServices } from '@/services/repositories';
import { createFixedClock } from '@/utils/clock';
import { createFakeStorage, type FakeStorage } from './fakeStorage';

export const TEST_INSTANT = '2026-10-15T10:00:00Z';
export const TEST_TIME_ZONE = 'Europe/Warsaw';

/** Real services (clock fixed, ids counted) over a fake storage the test controls. */
export function createTestServices(
  storage: FakeStorage = createFakeStorage(),
): AppServices & { storage: FakeStorage } {
  let counter = 0;
  const services = createLocalServices({
    storage,
    clock: createFixedClock(TEST_INSTANT),
    timeZone: TEST_TIME_ZONE,
    createId: () => `test-id-${String((counter += 1))}`,
  });
  return { ...services, storage };
}

/** A `wrapper` for Testing Library: renders children inside a ServicesProvider. */
export function servicesWrapper(services: AppServices) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ServicesProvider services={services}>{children}</ServicesProvider>;
  };
}

/** A promise the test resolves or rejects by hand, to control the order in which answers arrive. */
export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
