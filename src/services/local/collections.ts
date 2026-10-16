import type { Appointment } from '@/features/appointments/types';
import type { DoseLog } from '@/features/doses/types';
import { doseLogSlot, doseSlotKey } from '@/features/doses/logic/slots';
import type { Medication } from '@/features/medications/types';
import type { CollectionSpec } from './collection';
import { validateAppointment, validateDoseLog, validateMedication } from './validation';

/**
 * The storage keys. The "v1" is the storage format version (see collection.ts). Each kind of
 * record has its own key, so a problem in one collection never affects another.
 */
export const STORAGE_KEYS = {
  medications: 'pigoowa:v1:medications',
  doseLogs: 'pigoowa:v1:dose-logs',
  appointments: 'pigoowa:v1:appointments',
  /** One slot holding the previous contents of the three keys above after a demo data reset. */
  backup: 'pigoowa:v1:backup',
} as const;

export const medicationCollection: CollectionSpec<Medication> = {
  key: STORAGE_KEYS.medications,
  name: 'medications',
  validate: validateMedication,
  idOf: (medication) => medication.id,
};

export const doseLogCollection: CollectionSpec<DoseLog> = {
  key: STORAGE_KEYS.doseLogs,
  name: 'doseLogs',
  validate: validateDoseLog,
  idOf: (log) => log.id,
  slotOf: (log) => doseSlotKey(doseLogSlot(log)),
};

export const appointmentCollection: CollectionSpec<Appointment> = {
  key: STORAGE_KEYS.appointments,
  name: 'appointments',
  validate: validateAppointment,
  idOf: (appointment) => appointment.id,
};
