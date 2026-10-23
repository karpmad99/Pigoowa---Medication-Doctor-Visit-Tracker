import { APPOINTMENT_LIMITS } from '@/features/appointments/logic/validation';
import type { Appointment, AppointmentStatus } from '@/features/appointments/types';
import type { DoseLog } from '@/features/doses/types';
import { DOSE_NOTE_MAX } from '@/features/doses/logic/limits';
import { STOCK_EVENT_NOTE_MAX } from '@/features/stock/logic/limits';
import type { StockEvent } from '@/features/stock/types';
import { isDosageForm, isStrengthUnit } from '@/features/medications/logic/dosageForms';
import { MEDICATION_LIMITS } from '@/features/medications/logic/limits';
import { MAX_UNIT_LENGTH } from '@/features/medications/logic/stock';
import type {
  DosageForm,
  Medication,
  LowStockThreshold,
  MedicationStock,
  MedicationStrength,
  ScheduleTime,
} from '@/features/medications/types';
import type { Id, LocalDate, LocalTime, Timestamp } from '@/types/primitives';
import {
  compareLocalDates,
  compareTimestamps,
  parseLocalDate,
  parseLocalTime,
  parseTimestamp,
} from '@/utils/date';
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
  // `basis` is optional: absent means "counted" and stays absent (older data is not rewritten).
  if (input.basis === undefined) return { ok: true, value: { quantity, unit, asOf } };
  if (input.basis !== 'counted' && input.basis !== 'new-package') return fail(`${path}.basis`);
  return { ok: true, value: { quantity, unit, asOf, basis: input.basis } };
}

function validateStrength(input: unknown, path: string): Validated<MedicationStrength | null> {
  if (input === null) return { ok: true, value: null };
  if (!isRecord(input)) return fail(path);
  const value = readNumber(input.value, false);
  if (value === null) return fail(`${path}.value`);
  if (!isStrengthUnit(input.unit)) return fail(`${path}.unit`);
  return { ok: true, value: { value, unit: input.unit } };
}

function validateThreshold(input: unknown, path: string): Validated<LowStockThreshold | null> {
  if (input === null) return { ok: true, value: null };
  if (!isRecord(input)) return fail(path);
  const quantity = readNumber(input.quantity, true);
  if (quantity === null) return fail(`${path}.quantity`);
  const unit = readText(input.unit, 1, MAX_UNIT_LENGTH);
  if (unit === null) return fail(`${path}.unit`);
  return { ok: true, value: { quantity, unit } };
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
  // The two optional fields of stage F4 are absent on a medication saved before they existed, and
  // stay absent: a missing field is never turned into a value (or into `null`) here.
  let dosageForm: DosageForm | undefined;
  if (input.dosageForm !== undefined) {
    if (!isDosageForm(input.dosageForm)) return fail(`${path}.dosageForm`);
    dosageForm = input.dosageForm;
  }
  let strength: MedicationStrength | null | undefined;
  if (input.strength !== undefined) {
    const checked = validateStrength(input.strength, `${path}.strength`);
    if (!checked.ok) return checked;
    strength = checked.value;
  }
  // An own threshold needs a stock to be about (docs/DATABASE.md); absent stays absent.
  let lowStockThreshold: LowStockThreshold | null | undefined;
  if (input.lowStockThreshold !== undefined) {
    const checked = validateThreshold(input.lowStockThreshold, `${path}.lowStockThreshold`);
    if (!checked.ok) return checked;
    if (checked.value !== null && stock.value === null) return fail(`${path}.lowStockThreshold`);
    lowStockThreshold = checked.value;
  }
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
      ...(dosageForm === undefined ? {} : { dosageForm }),
      ...(strength === undefined ? {} : { strength }),
      ...(lowStockThreshold === undefined ? {} : { lowStockThreshold }),
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

  // The two optional fields of stage F8 belong to a taken dose only, and absent stays absent: a
  // record saved before them is not rewritten into one that has them.
  let takenAmount: number | undefined;
  if (input.takenAmount !== undefined) {
    if (input.status !== 'taken') return fail(`${path}.takenAmount`);
    const amount = readNumber(input.takenAmount, false);
    if (amount === null) return fail(`${path}.takenAmount`);
    takenAmount = amount;
  }
  let note: string | null | undefined;
  if (input.note !== undefined) {
    const checked = readNullableText(input.note, DOSE_NOTE_MAX);
    if (checked === undefined) return fail(`${path}.note`);
    if (checked !== null && input.status !== 'taken') return fail(`${path}.note`);
    note = checked;
  }

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
      ...(takenAmount === undefined ? {} : { takenAmount }),
      ...(note === undefined ? {} : { note }),
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

export function validateStockEvent(input: unknown, path = 'stockEvent'): Validated<StockEvent> {
  if (!isRecord(input)) return fail(path);
  const id = readId(input.id);
  if (id === null) return fail(`${path}.id`);
  const medicationId = readId(input.medicationId);
  if (medicationId === null) return fail(`${path}.medicationId`);
  if (input.kind !== 'refill' && input.kind !== 'waste') return fail(`${path}.kind`);
  const amount = readNumber(input.amount, false);
  if (amount === null) return fail(`${path}.amount`);
  const unit = readText(input.unit, 1, MAX_UNIT_LENGTH);
  if (unit === null) return fail(`${path}.unit`);
  const recordedAt = readTimestamp(input.recordedAt);
  if (recordedAt === null) return fail(`${path}.recordedAt`);
  const note = readNullableText(input.note, STOCK_EVENT_NOTE_MAX);
  if (note === undefined) return fail(`${path}.note`);
  let reversedAt: Timestamp | null = null;
  if (input.reversedAt !== null) {
    reversedAt = readTimestamp(input.reversedAt);
    if (reversedAt === null || compareTimestamps(reversedAt, recordedAt) < 0) {
      return fail(`${path}.reversedAt`);
    }
  }
  return {
    ok: true,
    value: { id, medicationId, kind: input.kind, amount, unit, recordedAt, note, reversedAt },
  };
}
