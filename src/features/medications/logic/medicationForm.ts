import type { LocalDate, LocalTime } from '@/types/primitives';
import { compareLocalDates, parseLocalDate, parseLocalTime } from '@/utils/date';
import { isValidQuantity, parseQuantityInput } from '@/utils/quantity';
import type { Medication } from '../types';
import { MEDICATION_LIMITS } from './limits';
import { normalizeScheduleTimes, validateScheduleTimes } from './schedule';

// The medication form works with TEXT, exactly as typed. These pure functions turn it into
// checked, typed values or into a list of problems (codes, not sentences: the Polish messages
// are attached in ../schemas.ts). The rules themselves are the Stage 2 ones, reused here.

export interface ScheduleTimeFormValues {
  /** Id of the stored schedule time this row came from; empty for a row added in the form. */
  scheduleTimeId: string;
  /** `HH:mm`, as the time input gives it. */
  timeOfDay: string;
  /** Amount as typed, e.g. "0,5". */
  doseAmount: string;
}

export interface MedicationFormValues {
  name: string;
  doseUnit: string;
  notes: string;
  /** `YYYY-MM-DD`, as the date input gives it. */
  startDate: string;
  /** Empty when the medication has no end date. */
  endDate: string;
  scheduleTimes: ScheduleTimeFormValues[];
  /** Empty when no stock information is given. Zero ("none left") is a valid stock. */
  stockQuantity: string;
}

export type MedicationFormIssueCode =
  | 'name-required'
  | 'name-too-long'
  | 'unit-required'
  | 'unit-too-long'
  | 'notes-too-long'
  | 'start-invalid'
  | 'end-invalid'
  | 'end-before-start'
  | 'schedule-empty'
  | 'time-invalid'
  | 'time-duplicate'
  | 'amount-invalid'
  | 'stock-invalid';

export interface MedicationFormIssue {
  /** Where the problem is, in React Hook Form's notation: "name", "scheduleTimes.1.timeOfDay". */
  path: string;
  code: MedicationFormIssueCode;
}

/** A new, empty form. The schedule starts with one blank row: no time or dose is ever pre-filled. */
export function emptyMedicationForm(today: LocalDate): MedicationFormValues {
  return {
    name: '',
    doseUnit: '',
    notes: '',
    startDate: today,
    endDate: '',
    scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '', doseAmount: '' }],
    stockQuantity: '',
  };
}

/** Quantities are shown with the Polish decimal comma and, unlike `formatQuantity`, no thousands separator. */
function quantityToText(value: number): string {
  return String(value).replace('.', ',');
}

/** The form values that show an existing medication, so it can be edited. */
export function medicationToFormValues(medication: Medication): MedicationFormValues {
  return {
    name: medication.name,
    doseUnit: medication.doseUnit,
    notes: medication.notes ?? '',
    startDate: medication.startDate,
    endDate: medication.endDate ?? '',
    scheduleTimes: normalizeScheduleTimes(medication.scheduleTimes).map((entry) => ({
      scheduleTimeId: entry.id,
      timeOfDay: entry.timeOfDay,
      doseAmount: quantityToText(entry.doseAmount),
    })),
    stockQuantity: medication.stock === null ? '' : quantityToText(medication.stock.quantity),
  };
}

/** Finds every problem in the form, in the order the fields appear. An empty list means it is valid. */
export function validateMedicationForm(values: MedicationFormValues): MedicationFormIssue[] {
  const issues: MedicationFormIssue[] = [];

  const name = values.name.trim();
  if (name === '') issues.push({ path: 'name', code: 'name-required' });
  else if (name.length > MEDICATION_LIMITS.name)
    issues.push({ path: 'name', code: 'name-too-long' });

  const unit = values.doseUnit.trim();
  if (unit === '') issues.push({ path: 'doseUnit', code: 'unit-required' });
  else if (unit.length > MEDICATION_LIMITS.doseUnit) {
    issues.push({ path: 'doseUnit', code: 'unit-too-long' });
  }

  if (values.notes.trim().length > MEDICATION_LIMITS.notes) {
    issues.push({ path: 'notes', code: 'notes-too-long' });
  }

  const startDate = parseLocalDate(values.startDate);
  if (startDate === null) issues.push({ path: 'startDate', code: 'start-invalid' });

  if (values.endDate !== '') {
    const endDate = parseLocalDate(values.endDate);
    if (endDate === null) issues.push({ path: 'endDate', code: 'end-invalid' });
    else if (startDate !== null && compareLocalDates(endDate, startDate) < 0) {
      issues.push({ path: 'endDate', code: 'end-before-start' });
    }
  }

  // The schedule rules are Stage 2's: an amount that cannot be read becomes NaN, which that
  // validation rejects like any other unusable amount.
  const schedule = validateScheduleTimes(
    values.scheduleTimes.map((row) => ({
      timeOfDay: row.timeOfDay,
      doseAmount: parseQuantityInput(row.doseAmount) ?? Number.NaN,
    })),
  );
  if (!schedule.ok) {
    for (const issue of schedule.issues) {
      const row = `scheduleTimes.${String(issue.index)}`;
      if (issue.code === 'empty') issues.push({ path: 'scheduleTimes', code: 'schedule-empty' });
      if (issue.code === 'invalid-time')
        issues.push({ path: `${row}.timeOfDay`, code: 'time-invalid' });
      if (issue.code === 'duplicate-time') {
        issues.push({ path: `${row}.timeOfDay`, code: 'time-duplicate' });
      }
      if (issue.code === 'invalid-amount') {
        issues.push({ path: `${row}.doseAmount`, code: 'amount-invalid' });
      }
    }
  }

  if (values.stockQuantity.trim() !== '') {
    const quantity = parseQuantityInput(values.stockQuantity);
    if (quantity === null || !isValidQuantity(quantity, { allowZero: true })) {
      issues.push({ path: 'stockQuantity', code: 'stock-invalid' });
    }
  }

  return issues;
}

export interface MedicationFormFields {
  name: string;
  doseUnit: string;
  notes: string | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
  scheduleTimes: { scheduleTimeId: string; timeOfDay: LocalTime; doseAmount: number }[];
  /** `null` when no stock information was given. */
  stockQuantity: number | null;
}

/**
 * Turns valid form text into typed values (trimmed text, real dates, numbers). Returns `null`
 * if the form is not valid, so nothing malformed can slip through as "just a string".
 */
export function readMedicationForm(values: MedicationFormValues): MedicationFormFields | null {
  if (validateMedicationForm(values).length > 0) return null;

  const startDate = parseLocalDate(values.startDate);
  const endDate = values.endDate === '' ? null : parseLocalDate(values.endDate);
  const stockQuantity =
    values.stockQuantity.trim() === '' ? null : parseQuantityInput(values.stockQuantity);
  if (startDate === null || (values.endDate !== '' && endDate === null)) return null;
  if (values.stockQuantity.trim() !== '' && stockQuantity === null) return null;

  const scheduleTimes: MedicationFormFields['scheduleTimes'] = [];
  for (const row of values.scheduleTimes) {
    const timeOfDay = parseLocalTime(row.timeOfDay);
    const doseAmount = parseQuantityInput(row.doseAmount);
    if (timeOfDay === null || doseAmount === null) return null;
    scheduleTimes.push({ scheduleTimeId: row.scheduleTimeId, timeOfDay, doseAmount });
  }

  const notes = values.notes.trim();
  return {
    name: values.name.trim(),
    doseUnit: values.doseUnit.trim(),
    notes: notes === '' ? null : notes,
    startDate,
    endDate,
    scheduleTimes,
    stockQuantity,
  };
}
