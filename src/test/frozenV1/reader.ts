import type { Appointment } from '@/features/appointments/types';
import type { DoseLog } from '@/features/doses/types';
import type { Medication } from '@/features/medications/types';
import { RepositoryError } from '@/services/errors';
import type { KeyValueStorage } from '@/services/local/storage';
import {
  validateAppointment,
  validateDoseLog,
  validateMedication,
  type Validated,
} from './validation';

// A FROZEN COPY of how the application read and wrote a collection before the storage migration
// (commit b321477, src/services/local/collection.ts and localRepositories.ts): the only accepted
// version is 1, a collection is read and validated before it is written, and it is written as
// version 1. It stands for an older copy of the application that is still running (another tab, an
// older deployment). Do not update it when the real code changes.

export const FROZEN_KEYS = {
  medications: 'pigoowa:v1:medications',
  doseLogs: 'pigoowa:v1:dose-logs',
  appointments: 'pigoowa:v1:appointments',
} as const;

interface FrozenSpec<T> {
  key: string;
  name: string;
  validate: (input: unknown, path: string) => Validated<T>;
  idOf: (item: T) => string;
  slotOf?: (item: T) => string;
}

export const frozenMedications: FrozenSpec<Medication> = {
  key: FROZEN_KEYS.medications,
  name: 'medications',
  validate: validateMedication,
  idOf: (item) => item.id,
};
export const frozenDoseLogs: FrozenSpec<DoseLog> = {
  key: FROZEN_KEYS.doseLogs,
  name: 'doseLogs',
  validate: validateDoseLog,
  idOf: (item) => item.id,
  slotOf: (log) => `${log.medicationId}|${log.scheduledDate}|${log.scheduledTime}`,
};
export const frozenAppointments: FrozenSpec<Appointment> = {
  key: FROZEN_KEYS.appointments,
  name: 'appointments',
  validate: validateAppointment,
  idOf: (item) => item.id,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The old `readCollection`: missing is empty; anything but a valid version 1 throws. */
export function frozenRead<T>(storage: KeyValueStorage, spec: FrozenSpec<T>): T[] {
  const raw = storage.getItem(spec.key);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RepositoryError('data-corrupted', { detail: `${spec.name}: not valid JSON` });
  }
  if (!isRecord(parsed) || typeof parsed.version !== 'number') {
    throw new RepositoryError('data-corrupted', { detail: `${spec.name}: unexpected structure` });
  }
  if (parsed.version !== 1) {
    throw new RepositoryError('unsupported-version', {
      detail: `${spec.name}: version ${String(parsed.version)}`,
    });
  }
  if (!Array.isArray(parsed.items)) {
    throw new RepositoryError('data-corrupted', { detail: `${spec.name}: items is not a list` });
  }
  const items: T[] = [];
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const [index, entry] of (parsed.items as unknown[]).entries()) {
    const result = spec.validate(entry, `${spec.name}[${String(index)}]`);
    if (!result.ok) {
      throw new RepositoryError('data-corrupted', { detail: `invalid field: ${result.path}` });
    }
    const id = spec.idOf(result.value);
    if (ids.has(id)) throw new RepositoryError('data-corrupted', { detail: 'duplicate id' });
    ids.add(id);
    if (spec.slotOf) {
      const slot = spec.slotOf(result.value);
      if (slots.has(slot))
        throw new RepositoryError('data-corrupted', { detail: 'duplicate slot' });
      slots.add(slot);
    }
    items.push(result.value);
  }
  return items;
}

/** The old `writeCollection`: always version 1. */
export function frozenWrite<T>(storage: KeyValueStorage, spec: FrozenSpec<T>, items: T[]): void {
  storage.setItem(spec.key, JSON.stringify({ version: 1, items }));
}

/** What an older copy does when the user adds an appointment: read, check, write version 1. */
export function frozenCreateAppointment(storage: KeyValueStorage, appointment: Appointment): void {
  const items = frozenRead(storage, frozenAppointments);
  if (items.some((existing) => existing.id === appointment.id)) {
    throw new RepositoryError('duplicate-id');
  }
  frozenWrite(storage, frozenAppointments, [...items, appointment]);
}

/** What an older copy does when the user adds a medication. */
export function frozenCreateMedication(storage: KeyValueStorage, medication: Medication): void {
  const items = frozenRead(storage, frozenMedications);
  frozenWrite(storage, frozenMedications, [...items, medication]);
}
