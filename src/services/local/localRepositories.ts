import type { Appointment } from '@/features/appointments/types';
import type { DoseLog, DoseSlot } from '@/features/doses/types';
import { doseLogSlot, doseSlotKey } from '@/features/doses/logic/slots';
import type { Id, LocalDate } from '@/types/primitives';
import { compareLocalDates, compareLocalTimes, compareTimestamps } from '@/utils/date';
import { RepositoryError, toRepositoryError } from '../errors';
import type {
  AppointmentRepository,
  DoseLogRepository,
  MedicationRepository,
  Repositories,
} from '../repositories';
import { readCollection, restoreRaw, writeCollection } from './collection';
import { appointmentCollection, doseLogCollection, medicationCollection } from './collections';
import type { KeyValueStorage } from './storage';
import type { Validated } from './validation';
import { validateAppointment, validateDoseLog, validateMedication } from './validation';

// Every operation reads the CURRENT stored state, changes it, and writes it back, all in one
// synchronous step with nothing awaited in between. So within this tab operations cannot
// interleave, nothing is cached that could go stale, and records an operation did not mean to
// touch are written back exactly as they were read. (Other browser tabs are not coordinated:
// the last write wins.)

/** Runs a synchronous operation and turns its result or failure into a Promise of the right shape. */
function run<T>(operation: () => T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(toRepositoryError(error));
  }
}

function accept<T>(result: Validated<T>): T {
  if (!result.ok) {
    throw new RepositoryError('invalid-input', { detail: `invalid field: ${result.path}` });
  }
  return result.value;
}

const nameCollator = new Intl.Collator('pl');

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function createMedicationRepository(storage: KeyValueStorage): MedicationRepository {
  return {
    list: () =>
      run(() =>
        readCollection(storage, medicationCollection).items.sort(
          (a, b) => nameCollator.compare(a.name, b.name) || compareText(a.id, b.id),
        ),
      ),

    get: (id) =>
      run(() => {
        const found = readCollection(storage, medicationCollection).items.find(
          (medication) => medication.id === id,
        );
        if (!found) throw new RepositoryError('not-found');
        return found;
      }),

    create: (input) =>
      run(() => {
        const medication = accept(validateMedication(input));
        const { items } = readCollection(storage, medicationCollection);
        if (items.some((existing) => existing.id === medication.id)) {
          throw new RepositoryError('duplicate-id');
        }
        writeCollection(storage, medicationCollection, [...items, medication]);
        return medication;
      }),

    update: (input) =>
      run(() => {
        const medication = accept(validateMedication(input));
        const { items } = readCollection(storage, medicationCollection);
        if (!items.some((existing) => existing.id === medication.id)) {
          throw new RepositoryError('not-found');
        }
        writeCollection(
          storage,
          medicationCollection,
          items.map((existing) => (existing.id === medication.id ? medication : existing)),
        );
        return medication;
      }),

    remove: (id) =>
      run(() => {
        // Read and check everything BEFORE changing anything.
        const medications = readCollection(storage, medicationCollection);
        const logs = readCollection(storage, doseLogCollection);
        if (!medications.items.some((medication) => medication.id === id)) {
          throw new RepositoryError('not-found');
        }
        const remainingLogs = logs.items.filter((log) => log.medicationId !== id);

        writeCollection(
          storage,
          medicationCollection,
          medications.items.filter((medication) => medication.id !== id),
        );
        if (remainingLogs.length === logs.items.length) return;
        try {
          writeCollection(storage, doseLogCollection, remainingLogs);
        } catch (error) {
          // Two keys cannot be changed atomically. Put the medication back so a failure never
          // leaves the medication gone but its history still stored (or the reverse).
          const restored = restoreRaw(storage, medicationCollection.key, medications.raw);
          throw new RepositoryError(toRepositoryError(error).code, {
            cause: error,
            detail: restored ? 'rolled back' : 'rollback failed: data may be inconsistent',
          });
        }
      }),
  };
}

function compareDoseLogs(a: DoseLog, b: DoseLog): number {
  return (
    compareLocalDates(a.scheduledDate, b.scheduledDate) ||
    compareLocalTimes(a.scheduledTime, b.scheduledTime) ||
    compareText(a.medicationId, b.medicationId) ||
    compareText(a.id, b.id)
  );
}

function createDoseLogRepository(storage: KeyValueStorage): DoseLogRepository {
  return {
    listByDateRange: (from: LocalDate, to: LocalDate) =>
      run(() => {
        if (compareLocalDates(from, to) > 0) {
          throw new RepositoryError('invalid-input', { detail: 'range start is after its end' });
        }
        return readCollection(storage, doseLogCollection)
          .items.filter(
            (log) =>
              compareLocalDates(log.scheduledDate, from) >= 0 &&
              compareLocalDates(log.scheduledDate, to) <= 0,
          )
          .sort(compareDoseLogs);
      }),

    upsert: (input) =>
      run(() => {
        const log = accept(validateDoseLog(input));
        const medications = readCollection(storage, medicationCollection).items;
        if (!medications.some((medication) => medication.id === log.medicationId)) {
          throw new RepositoryError('missing-reference');
        }
        const { items } = readCollection(storage, doseLogCollection);
        const slotKey = doseSlotKey(doseLogSlot(log));
        const occupant = items.find(
          (existing) => doseSlotKey(doseLogSlot(existing)) === slotKey && existing.id !== log.id,
        );
        if (occupant) throw new RepositoryError('duplicate-slot');

        const exists = items.some((existing) => existing.id === log.id);
        writeCollection(
          storage,
          doseLogCollection,
          exists
            ? items.map((existing) => (existing.id === log.id ? log : existing))
            : [...items, log],
        );
        return log;
      }),

    remove: (slot: DoseSlot) =>
      run(() => {
        const { items } = readCollection(storage, doseLogCollection);
        const slotKey = doseSlotKey(slot);
        const remaining = items.filter((log) => doseSlotKey(doseLogSlot(log)) !== slotKey);
        // Nothing to remove: succeed without touching storage, so undo can be repeated freely.
        if (remaining.length === items.length) return;
        writeCollection(storage, doseLogCollection, remaining);
      }),
  };
}

function compareAppointments(a: Appointment, b: Appointment): number {
  return compareTimestamps(a.scheduledAt, b.scheduledAt) || compareText(a.id, b.id);
}

function createAppointmentRepository(storage: KeyValueStorage): AppointmentRepository {
  return {
    list: () =>
      run(() => readCollection(storage, appointmentCollection).items.sort(compareAppointments)),

    get: (id: Id) =>
      run(() => {
        const found = readCollection(storage, appointmentCollection).items.find(
          (appointment) => appointment.id === id,
        );
        if (!found) throw new RepositoryError('not-found');
        return found;
      }),

    create: (input) =>
      run(() => {
        const appointment = accept(validateAppointment(input));
        const { items } = readCollection(storage, appointmentCollection);
        if (items.some((existing) => existing.id === appointment.id)) {
          throw new RepositoryError('duplicate-id');
        }
        writeCollection(storage, appointmentCollection, [...items, appointment]);
        return appointment;
      }),

    update: (input) =>
      run(() => {
        const appointment = accept(validateAppointment(input));
        const { items } = readCollection(storage, appointmentCollection);
        if (!items.some((existing) => existing.id === appointment.id)) {
          throw new RepositoryError('not-found');
        }
        writeCollection(
          storage,
          appointmentCollection,
          items.map((existing) => (existing.id === appointment.id ? appointment : existing)),
        );
        return appointment;
      }),

    remove: (id: Id) =>
      run(() => {
        const { items } = readCollection(storage, appointmentCollection);
        if (!items.some((existing) => existing.id === id)) throw new RepositoryError('not-found');
        writeCollection(
          storage,
          appointmentCollection,
          items.filter((existing) => existing.id !== id),
        );
      }),
  };
}

/** The repositories, keeping their data in the given storage. */
export function createLocalRepositories(storage: KeyValueStorage): Repositories {
  return {
    medications: createMedicationRepository(storage),
    doseLogs: createDoseLogRepository(storage),
    appointments: createAppointmentRepository(storage),
  };
}
