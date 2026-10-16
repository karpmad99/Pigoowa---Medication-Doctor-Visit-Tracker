import type { Id } from '@/types/primitives';
import { getUserTimeZone, systemClock, type Clock } from '@/utils/clock';
import { createId } from '@/utils/id';
import type { AppServices } from '../repositories';
import { createLocalDemoData } from './localDemoData';
import { createLocalRepositories } from './localRepositories';
import { createBrowserStorage, type KeyValueStorage } from './storage';

export interface LocalServicesOptions {
  /** Defaults to the browser's localStorage. Tests pass a fake. */
  storage?: KeyValueStorage;
  /** Defaults to the real time. */
  clock?: Clock;
  /** Defaults to the browser's time zone. */
  timeZone?: string;
  /** Defaults to random UUIDs. */
  createId?: () => Id;
}

/** Wires the browser-storage implementation of everything the application needs. */
export function createLocalServices(options: LocalServicesOptions = {}): AppServices {
  const storage = options.storage ?? createBrowserStorage();
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? getUserTimeZone();
  return {
    clock,
    timeZone,
    createId: options.createId ?? createId,
    repositories: createLocalRepositories(storage),
    demoData: createLocalDemoData({ storage, clock, timeZone }),
  };
}
