import type { Appointment } from '@/features/appointments/types';
import type { DoseLog } from '@/features/doses/types';
import type { Medication, ScheduleTime } from '@/features/medications/types';
import type { StockEvent } from '@/features/stock/types';
import { RepositoryError } from '../errors';
import {
  validateAppointment,
  validateDoseLog,
  validateMedication,
  validateStockEvent,
  type Validated,
} from '../local/validation';
import type { Database } from './database.types';

// Rows of the tables (docs/DATABASE.md §3) <-> the domain types (§9). Everything read from the database
// goes through the same validators as everything read from the browser's storage: a row that does not
// satisfy the application's rules is reported as `data-corrupted`, never shown or "repaired".
//
// The mapping is exact except in one place the database cannot express: an optional field the application
// leaves ABSENT and one it sets to `null` are both a SQL NULL. They are read back as ABSENT, which means
// the same to every screen ("none").

type Tables = Database['public']['Tables'];
export type MedicationRow = Tables['medications']['Row'];
export type ScheduleTimeRow = Tables['medication_schedule_times']['Row'];
export type DoseLogRow = Tables['dose_logs']['Row'];
export type AppointmentRow = Tables['appointments']['Row'];
export type StockEventRow = Tables['stock_events']['Row'];

function accept<T>(result: Validated<T>): T {
  if (!result.ok) {
    throw new RepositoryError('data-corrupted', { detail: `invalid field: ${result.path}` });
  }
  return result.value;
}

/** `time` columns come back as HH:MM:SS; the application's LocalTime is HH:mm. */
function toLocalTimeText(value: string): string {
  return value.slice(0, 5);
}

// ----- medications -----

export function scheduleTimeFromRow(row: ScheduleTimeRow): ScheduleTime {
  return {
    id: row.id,
    timeOfDay: toLocalTimeText(row.time_of_day) as ScheduleTime['timeOfDay'],
    doseAmount: row.dose_amount,
  };
}

export function medicationFromRows(row: MedicationRow, times: ScheduleTimeRow[]): Medication {
  const scheduleTimes = times
    .map(scheduleTimeFromRow)
    .sort((a, b) => (a.timeOfDay < b.timeOfDay ? -1 : a.timeOfDay > b.timeOfDay ? 1 : 0));
  return accept(
    validateMedication({
      id: row.id,
      name: row.name,
      doseUnit: row.dose_unit,
      ...(row.dosage_form === null ? {} : { dosageForm: row.dosage_form }),
      ...(row.strength_value === null || row.strength_unit === null
        ? {}
        : { strength: { value: row.strength_value, unit: row.strength_unit } }),
      ...(row.low_stock_threshold === null || row.low_stock_threshold_unit === null
        ? {}
        : {
            lowStockThreshold: {
              quantity: row.low_stock_threshold,
              unit: row.low_stock_threshold_unit,
            },
          }),
      notes: row.notes,
      startDate: row.start_date,
      endDate: row.end_date,
      scheduleEffectiveFrom: row.schedule_effective_from,
      scheduleTimes,
      stock:
        row.stock_quantity === null || row.stock_unit === null || row.stock_as_of === null
          ? null
          : {
              quantity: row.stock_quantity,
              unit: row.stock_unit,
              asOf: row.stock_as_of,
              ...(row.stock_basis === null ? {} : { basis: row.stock_basis }),
            },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
}

export function medicationToRow(medication: Medication): Tables['medications']['Insert'] {
  return {
    id: medication.id,
    name: medication.name,
    dose_unit: medication.doseUnit,
    notes: medication.notes,
    start_date: medication.startDate,
    end_date: medication.endDate,
    schedule_effective_from: medication.scheduleEffectiveFrom,
    stock_quantity: medication.stock?.quantity ?? null,
    stock_unit: medication.stock?.unit ?? null,
    stock_as_of: medication.stock?.asOf ?? null,
    stock_basis: medication.stock?.basis ?? null,
    dosage_form: medication.dosageForm ?? null,
    strength_value: medication.strength?.value ?? null,
    strength_unit: medication.strength?.unit ?? null,
    low_stock_threshold: medication.lowStockThreshold?.quantity ?? null,
    low_stock_threshold_unit: medication.lowStockThreshold?.unit ?? null,
    created_at: medication.createdAt,
    updated_at: medication.updatedAt,
  };
}

export function scheduleTimeToRow(
  medicationId: string,
  time: ScheduleTime,
): Tables['medication_schedule_times']['Insert'] {
  return {
    id: time.id,
    medication_id: medicationId,
    time_of_day: time.timeOfDay,
    dose_amount: time.doseAmount,
  };
}

// ----- intake records -----

export function doseLogFromRow(row: DoseLogRow): DoseLog {
  return accept(
    validateDoseLog({
      id: row.id,
      medicationId: row.medication_id,
      scheduledDate: row.scheduled_date,
      scheduledTime: toLocalTimeText(row.scheduled_time),
      status: row.status,
      doseAmount: row.dose_amount,
      doseUnit: row.dose_unit,
      recordedAt: row.recorded_at,
      ...(row.taken_amount === null ? {} : { takenAmount: row.taken_amount }),
      ...(row.note === null ? {} : { note: row.note }),
    }),
  );
}

export function doseLogToRow(log: DoseLog): Tables['dose_logs']['Insert'] {
  return {
    id: log.id,
    medication_id: log.medicationId,
    scheduled_date: log.scheduledDate,
    scheduled_time: log.scheduledTime,
    status: log.status,
    dose_amount: log.doseAmount,
    dose_unit: log.doseUnit,
    recorded_at: log.recordedAt,
    taken_amount: log.takenAmount ?? null,
    note: log.note ?? null,
  };
}

// ----- appointments -----

export function appointmentFromRow(row: AppointmentRow): Appointment {
  return accept(
    validateAppointment({
      id: row.id,
      doctorName: row.doctor_name,
      specialty: row.specialty,
      scheduledAt: row.scheduled_at,
      location: row.location,
      notes: row.notes,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
}

export function appointmentToRow(appointment: Appointment): Tables['appointments']['Insert'] {
  return {
    id: appointment.id,
    doctor_name: appointment.doctorName,
    specialty: appointment.specialty,
    scheduled_at: appointment.scheduledAt,
    location: appointment.location,
    notes: appointment.notes,
    status: appointment.status,
    created_at: appointment.createdAt,
    updated_at: appointment.updatedAt,
  };
}

// ----- stock events -----

export function stockEventFromRow(row: StockEventRow): StockEvent {
  return accept(
    validateStockEvent({
      id: row.id,
      medicationId: row.medication_id,
      kind: row.kind,
      amount: row.amount,
      unit: row.unit,
      recordedAt: row.recorded_at,
      note: row.note,
      reversedAt: row.reversed_at,
    }),
  );
}

export function stockEventToRow(event: StockEvent): Tables['stock_events']['Insert'] {
  return {
    id: event.id,
    medication_id: event.medicationId,
    kind: event.kind,
    amount: event.amount,
    unit: event.unit,
    recorded_at: event.recordedAt,
    note: event.note,
    reversed_at: event.reversedAt,
  };
}
