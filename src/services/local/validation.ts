import { APPOINTMENT_LIMITS } from '@/features/appointments/logic/validation';
import type { Appointment, AppointmentStatus } from '@/features/appointments/types';
import type { DoseLog } from '@/features/doses/types';
import { MEDICATION_LIMITS } from '@/features/medications/logic/limits';
import { MAX_UNIT_LENGTH } from '@/features/medications/logic/stock';
import type { Medication, MedicationStock, ScheduleTime } from '@/features/medications/types';
import type { Id, LocalDate, LocalTime, Timestamp } from '@/types/primitives';
import { compareLocalDates, parseLocalDate, parseLocalTime, parseTimestamp } from '@/utils/date';
import { isValidQuantity } from '@/utils/quantity';

// TypeScript types describe data the program creates; they say nothing about JSON read back
// from storage, which anyone (or any bug) may have changed. These functions check every field of
// an entity and return a fresh, trusted copy. The same checks run before writing, so what is
// stored always passes them. On failure they report WHERE (a path such as
// "medications[2].doseUnit"), never the offending value, so reports cannot leak health data.
// The limits mirror the database columns in docs/DATABASE.md.

export type Validated<T> = { ok: true; value: T } | { ok: false; path: string };

const MAX_ID_LENGTH = 100;

function fail(path: string): { ok: false; path: string } {
  return { ok: false, path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(value: unknown): Id | null {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ID_LENGTH
    ? value
    : null;
}

/** A string whose trimmed length is between `min` and `max`. */
function readText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const length = value.trim().length;
  return length >= min && length <= max ? value : null;
}

/** `null`, or a string no longer than `max`. `undefined` (a missing field) is rejected. */
function readNullableText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  return readText(value, 0, max) ?? undefined;
}

function readNumber(value: unknown, allowZero: boolean): number | null {
  return typeof value === 'number' && isValidQuantity(value, { allowZero }) ? value : null;
}

function readLocalDate(value: unknown): LocalDate | null {
  return typeof value === 'string' ? parseLocalDate(value) : null;
}

function readLocalTime(value: unknown): LocalTime | null {
  return typeof value === 'string' ? parseLocalTime(value) : null;
}

function readTimestamp(value: unknown): Timestamp | null {
  return typeof value === 'string' ? parseTimestamp(value) : null;
}

function validateScheduleTime(input: unknown, path: string): Validated<ScheduleTime> {
  if (!isRecord(input)) return fail(path);
  const id = readId(input.id);
  if (id === null) return fail(`${path}.id`);
  const timeOfDay = readLocalTime(input.timeOfDay);
  if (timeOfDay === null) return fail(`${path}.timeOfDay`);
  const doseAmount = readNumber(input.doseAmount, false);
  if (doseAmount === null) return fail(`${path}.doseAmount`);
  return { ok: true, value: { id, timeOfDay, doseAmount } };
}

function validateStock(input: unknown, path: string): Validated<MedicationStock | null> {
  if (input === null) return { ok: true, value: null };
  if (!isRecord(input)) return fail(path);
  const quantity = readNumber(input.quantity, true);
  if (quantity === null) return fail(`${path}.quantity`);
  const unit = readText(input.unit, 1, MAX_UNIT_LENGTH);
  if (unit === null) return fail(`${path}.unit`);
  const asOf = readTimestamp(input.asOf);
  if (asOf === null) return fail(`${path}.asOf`);
  return { ok: true, value: { quantity, unit, asOf } };
}

function validateScheduleTimes(input: unknown, path: string): Validated<ScheduleTime[]> {
  if (!Array.isArray(input)) return fail(path);
  const times: ScheduleTime[] = [];
  const ids = new Set<string>();
  const timesOfDay = new Set<string>();
  for (const [index, raw] of (input as unknown[]).entries()) {
    const entryPath = `${path}[${String(index)}]`;
    const result = validateScheduleTime(raw, entryPath);
    if (!result.ok) return result;
    // The database has the same two uniqueness rules (docs/DATABASE.md).
    if (ids.has(result.value.id)) return fail(`${entryPath}.id`);
    if (timesOfDay.has(result.value.timeOfDay)) return fail(`${entryPath}.timeOfDay`);
    ids.add(result.value.id);
    timesOfDay.add(result.value.timeOfDay);
    times.push(result.value);
  }
  return { ok: true, value: times };
}

export function validateMedication(input: unknown, path = 'medication'): Validated<Medication> {
  if (!isRecord(input)) return fail(path);
  const id = readId(input.id);
  if (id === null) return fail(`${path}.id`);
  const name = readText(input.name, 1, MEDICATION_LIMITS.name);
  if (name === null) return fail(`${path}.name`);
  const doseUnit = readText(input.doseUnit, 1, MEDICATION_LIMITS.doseUnit);
  if (doseUnit === null) return fail(`${path}.doseUnit`);
  const notes = readNullableText(input.notes, MEDICATION_LIMITS.notes);
  if (notes === undefined) return fail(`${path}.notes`);
  const startDate = readLocalDate(input.startDate);
  if (startDate === null) return fail(`${path}.startDate`);
  let endDate: LocalDate | null = null;
  if (input.endDate !== null) {
    endDate = readLocalDate(input.endDate);
    if (endDate === null || compareLocalDates(endDate, startDate) < 0) {
      return fail(`${path}.endDate`);
    }
  }
  const scheduleEffectiveFrom = readLocalDate(input.scheduleEffectiveFrom);
  if (scheduleEffectiveFrom === null || compareLocalDates(scheduleEffectiveFrom, startDate) < 0) {
    return fail(`${path}.scheduleEffectiveFrom`);
  }
  const scheduleTimes = validateScheduleTimes(input.scheduleTimes, `${path}.scheduleTimes`);
  if (!scheduleTimes.ok) return scheduleTimes;
  const stock = validateStock(input.stock, `${path}.stock`);
  if (!stock.ok) return stock;
  const createdAt = readTimestamp(input.createdAt);
  if (createdAt === null) return fail(`${path}.createdAt`);
  const updatedAt = readTimestamp(input.updatedAt);
  if (updatedAt === null) return fail(`${path}.updatedAt`);

  return {
    ok: true,
    value: {
      id,
      name,
      doseUnit,
      notes,
      startDate,
      endDate,
      scheduleEffectiveFrom,
      scheduleTimes: scheduleTimes.value,
      stock: stock.value,
      createdAt,
      updatedAt,
    },
  };
}

export function validateDoseLog(input: unknown, path = 'doseLog'): Validated<DoseLog> {
  if (!isRecord(input)) return fail(path);
  const id = readId(input.id);
  if (id === null) return fail(`${path}.id`);
  const medicationId = readId(input.medicationId);
  if (medicationId === null) return fail(`${path}.medicationId`);
  const scheduledDate = readLocalDate(input.scheduledDate);
  if (scheduledDate === null) return fail(`${path}.scheduledDate`);
  const scheduledTime = readLocalTime(input.scheduledTime);
  if (scheduledTime === null) return fail(`${path}.scheduledTime`);
  if (input.status !== 'taken' && input.status !== 'skipped') return fail(`${path}.status`);
  const doseAmount = readNumber(input.doseAmount, false);
  if (doseAmount === null) return fail(`${path}.doseAmount`);
  const doseUnit = readText(input.doseUnit, 1, MEDICATION_LIMITS.doseUnit);
  if (doseUnit === null) return fail(`${path}.doseUnit`);
  const recordedAt = readTimestamp(input.recordedAt);
  if (recordedAt === null) return fail(`${path}.recordedAt`);

  return {
    ok: true,
    value: {
      id,
      medicationId,
      scheduledDate,
      scheduledTime,
      status: input.status,
      doseAmount,
      doseUnit,
      recordedAt,
    },
  };
}

const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'completed', 'cancelled'];

export function validateAppointment(input: unknown, path = 'appointment'): Validated<Appointment> {
  if (!isRecord(input)) return fail(path);
  const id = readId(input.id);
  if (id === null) return fail(`${path}.id`);
  const doctorName = readNullableText(input.doctorName, APPOINTMENT_LIMITS.doctorName);
  if (doctorName === undefined) return fail(`${path}.doctorName`);
  const specialty = readNullableText(input.specialty, APPOINTMENT_LIMITS.specialty);
  if (specialty === undefined) return fail(`${path}.specialty`);
  // As in the database: at least one of the two must say something.
  if ((doctorName ?? '').trim() === '' && (specialty ?? '').trim() === '') {
    return fail(`${path}.doctorName`);
  }
  const scheduledAt = readTimestamp(input.scheduledAt);
  if (scheduledAt === null) return fail(`${path}.scheduledAt`);
  const location = readNullableText(input.location, APPOINTMENT_LIMITS.location);
  if (location === undefined) return fail(`${path}.location`);
  const notes = readNullableText(input.notes, APPOINTMENT_LIMITS.notes);
  if (notes === undefined) return fail(`${path}.notes`);
  const status = APPOINTMENT_STATUSES.find((candidate) => candidate === input.status);
  if (status === undefined) return fail(`${path}.status`);
  const createdAt = readTimestamp(input.createdAt);
  if (createdAt === null) return fail(`${path}.createdAt`);
  const updatedAt = readTimestamp(input.updatedAt);
  if (updatedAt === null) return fail(`${path}.updatedAt`);

  return {
    ok: true,
    value: {
      id,
      doctorName,
      specialty,
      scheduledAt,
      location,
      notes,
      status,
      createdAt,
      updatedAt,
    },
  };
}
