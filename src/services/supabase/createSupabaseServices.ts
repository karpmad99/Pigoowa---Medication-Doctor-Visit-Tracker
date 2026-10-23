import { EMPTY_MIGRATION_REPORT } from '../migrationReport';
import { RepositoryError } from '../errors';
import type { AppServices } from '../repositories';
import { createId } from '@/utils/id';
import { systemClock, type Clock } from '@/utils/clock';
import type { PigoowaClient } from './client';
import { createSupabaseRepositories } from './supabaseRepositories';

export interface SupabaseServicesOptions {
  client: PigoowaClient;
  /** The signed-in user's time zone, from the profile (PROJECT_SPEC DEC-10). */
  timeZone: string;
  /** Called when an operation found that the session is gone, so the application can send the user to sign in. */
  onSessionLost: () => void;
  clock?: Clock;
}

/**
 * Everything the application needs, for one signed-in user, with the data in her Supabase account.
 * It replaces the browser-storage services: nothing in it reads or writes `localStorage` data of the
 * demonstration, and the demonstration's sample data can never be loaded into an account.
 */
export function createSupabaseServices(options: SupabaseServicesOptions): AppServices {
  const refuse = () => Promise.reject(new RepositoryError('demo-data-unavailable'));
  return {
    clock: options.clock ?? systemClock,
    timeZone: options.timeZone,
    createId,
    repositories: createSupabaseRepositories(options.client, {
      onSessionLost: options.onSessionLost,
    }),
    demoData: { loadDemoData: refuse, resetDemoData: refuse },
    // The migration of the browser's own storage format does not apply to a database.
    storageMigration: {
      current: () => EMPTY_MIGRATION_REPORT,
      run: () => EMPTY_MIGRATION_REPORT,
    },
  };
}
