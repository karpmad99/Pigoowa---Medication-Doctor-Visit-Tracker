import type { Timestamp } from '@/types/primitives';
import type { Clock } from '@/utils/clock';
import { RepositoryError, toRepositoryError } from '../errors';
import type { DemoDataControls } from '../repositories';
import { createDemoData } from '../demo/demoData';
import { replaceCollection, restoreRaw, writeRaw } from './collection';
import {
  appointmentCollection,
  doseLogCollection,
  medicationCollection,
  STORAGE_KEYS,
  stockEventCollection,
} from './collections';
import type { KeyValueStorage } from './storage';

const DATA_KEYS = [
  STORAGE_KEYS.medications,
  STORAGE_KEYS.doseLogs,
  STORAGE_KEYS.appointments,
  STORAGE_KEYS.stockEvents,
];

interface BackupContents {
  version: 1;
  backedUpAt: Timestamp;
  /** The raw stored text of each data key at the time (null = nothing was stored), kept exactly as it was. */
  entries: Record<string, string | null>;
}

function readRawKey(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch (cause) {
    throw new RepositoryError('storage-unavailable', { cause });
  }
}

export interface LocalDemoDataOptions {
  storage: KeyValueStorage;
  clock: Clock;
  timeZone: string;
}

/**
 * Loading or resetting demo data is always an explicit call, never a side effect of reading or
 * writing ordinary data. Both work on the stored text directly, so they also work when the stored
 * data is corrupted (which is exactly when a reset is needed).
 */
export function createLocalDemoData({
  storage,
  clock,
  timeZone,
}: LocalDemoDataOptions): DemoDataControls {
  function writeDemoData(): void {
    const demo = createDemoData({ now: clock.now(), timeZone });
    // Replacing everything is the point of these controls, so the write gate does not apply (they
    // keep a backup of their own and write the current format).
    replaceCollection(storage, medicationCollection, demo.medications);
    replaceCollection(storage, doseLogCollection, demo.doseLogs);
    replaceCollection(storage, appointmentCollection, demo.appointments);
    replaceCollection(storage, stockEventCollection, demo.stockEvents);
  }

  function restoreAll(previous: Record<string, string | null>): boolean {
    // A write that was refused left its key as it was: putting that key back is not needed, and
    // would be refused again for the same reason. Every key is attempted, whatever the others do.
    return Object.entries(previous)
      .map(([key, raw]) => {
        try {
          if (storage.getItem(key) === raw) return true;
        } catch {
          // Unreadable: try to restore it anyway.
        }
        return restoreRaw(storage, key, raw);
      })
      .every(Boolean);
  }

  return {
    loadDemoData: () => {
      try {
        const previous = Object.fromEntries(
          DATA_KEYS.map((key) => [key, readRawKey(storage, key)]),
        );
        if (Object.values(previous).some((raw) => raw !== null)) {
          throw new RepositoryError('demo-data-not-empty');
        }
        try {
          writeDemoData();
        } catch (error) {
          // Never leave half of the demo data behind.
          const restored = restoreAll(previous);
          throw new RepositoryError(toRepositoryError(error).code, {
            cause: error,
            detail: restored ? 'rolled back' : 'rollback failed',
          });
        }
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(toRepositoryError(error));
      }
    },

    resetDemoData: () => {
      try {
        const previous = Object.fromEntries(
          DATA_KEYS.map((key) => [key, readRawKey(storage, key)]),
        );

        // 1. Save what is there now (even corrupted data). If that fails, change nothing.
        const backup: BackupContents = { version: 1, backedUpAt: clock.now(), entries: previous };
        try {
          writeRaw(storage, STORAGE_KEYS.backup, JSON.stringify(backup), 'backup');
        } catch (error) {
          throw new RepositoryError(toRepositoryError(error).code, {
            cause: error,
            detail: 'could not write the backup, nothing was changed',
          });
        }

        // 2. Replace it with demo data, undoing everything if any write fails.
        try {
          writeDemoData();
        } catch (error) {
          const restored = restoreAll(previous);
          throw new RepositoryError(toRepositoryError(error).code, {
            cause: error,
            detail: restored ? 'rolled back' : 'rollback failed',
          });
        }
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(toRepositoryError(error));
      }
    },
  };
}
