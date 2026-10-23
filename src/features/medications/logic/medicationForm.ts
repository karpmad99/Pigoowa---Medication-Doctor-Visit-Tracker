import type { LocalDate, LocalTime } from '@/types/primitives';
import { compareLocalDates, parseLocalDate, parseLocalTime } from '@/utils/date';
import { isValidQuantity, parseQuantityInput } from '@/utils/quantity';
import type { DosageForm, Medication, MedicationStrength } from '../types';
import { isDosageForm, isStrengthUnit } from './dosageForms';
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
  /** A `DosageForm`, or empty when none is chosen (older medications, or never chosen). */
  dosageForm: string;
  doseUnit: string;
  /** The strength as typed ("500", "0,5"); empty when no strength is given. */
  strengthValue: string;
  /** One of `STRENGTH_UNITS`, or empty when no strength is given. */
  strengthUnit: string;
  notes: string;
  /** `YYYY-MM-DD`, as the date input gives it. */
  startDate: string;
  /** Empty when the medication has no end date. */
  endDate: string;
  scheduleTimes: ScheduleTimeFormValues[];
  /** Empty when no stock information is given. Zero ("none left") is a valid stock. */
  stockQuantity: string;
  /**
   * The unit the stock is counted in, as stored or as chosen. Empty means "the same as the dose
   * unit" (a new medication). It is never converted: a different unit only makes the estimate
   * unavailable, and the form says so.
   */
  stockUnit: string;
  /** The own low-stock threshold as typed, in the stock unit; empty when there is none. */
  lowStockThreshold: string;
  /**
   * The unit a STORED threshold is in; empty for one that is typed now (it is then in the stock
   * unit). Editing the threshold number clears it. It lets the form notice a threshold whose unit
   * no longer matches the stock, and keep it as it was until the person decides.
   */
  lowStockThresholdUnit: string;
}

export type MedicationFormIssueCode =
  | 'name-required'
  | 'name-too-long'
  | 'unit-required'
  | 'unit-too-long'
  | 'dosage-form-invalid'
  | 'strength-value-invalid'
  | 'strength-value-required'
  | 'strength-unit-required'
  | 'strength-unit-invalid'
  | 'stock-unit-too-long'
  | 'threshold-invalid'
  | 'threshold-needs-stock'
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
    dosageForm: '',
    doseUnit: '',
    strengthValue: '',
    strengthUnit: '',
    notes: '',
    startDate: today,
    endDate: '',
    scheduleTimes: [{ scheduleTimeId: '', timeOfDay: '', doseAmount: '' }],
    stockQuantity: '',
    stockUnit: '',
    lowStockThreshold: '',
    lowStockThresholdUnit: '',
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
    dosageForm: medication.dosageForm ?? '',
    // The stored text exactly as it is: nothing is trimmed or replaced by a listed unit.
    doseUnit: medication.doseUnit,
    strengthValue: medication.strength == null ? '' : quantityToText(medication.strength.value),
    strengthUnit: medication.strength?.unit ?? '',
    notes: medication.notes ?? '',
    startDate: medication.startDate,
    endDate: medication.endDate ?? '',
    scheduleTimes: normalizeScheduleTimes(medication.scheduleTimes).map((entry) => ({
      scheduleTimeId: entry.id,
      timeOfDay: entry.timeOfDay,
      doseAmount: quantityToText(entry.doseAmount),
    })),
    stockQuantity: medication.stock === null ? '' : quantityToText(medication.stock.quantity),
    stockUnit: medication.stock === null ? '' : medication.stock.unit,
    lowStockThreshold:
      medication.lowStockThreshold == null
        ? ''
        : quantityToText(medication.lowStockThreshold.quantity),
    lowStockThresholdUnit: medication.lowStockThreshold?.unit ?? '',
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

  if (values.dosageForm !== '' && !isDosageForm(values.dosageForm)) {
    issues.push({ path: 'dosageForm', code: 'dosage-form-invalid' });
  }

  // The strength is a pair: both parts or neither. It is information only.
  const hasStrengthValue = values.strengthValue.trim() !== '';
  const hasStrengthUnit = values.strengthUnit !== '';
  if (hasStrengthValue) {
    const strength = parseQuantityInput(values.strengthValue);
    if (strength === null || !isValidQuantity(strength, { allowZero: false })) {
      issues.push({ path: 'strengthValue', code: 'strength-value-invalid' });
    }
    if (!hasStrengthUnit) issues.push({ path: 'strengthUnit', code: 'strength-unit-required' });
  } else if (hasStrengthUnit) {
    issues.push({ path: 'strengthValue', code: 'strength-value-required' });
  }
  if (hasStrengthUnit && !isStrengthUnit(values.strengthUnit)) {
    issues.push({ path: 'strengthUnit', code: 'strength-unit-invalid' });
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

  // The own threshold: zero is allowed ("warn only when it is used up"); it needs a stock.
  if (values.lowStockThreshold.trim() !== '') {
    const threshold = parseQuantityInput(values.lowStockThreshold);
    if (threshold === null || !isValidQuantity(threshold, { allowZero: true })) {
      issues.push({ path: 'lowStockThreshold', code: 'threshold-invalid' });
    } else if (values.stockQuantity.trim() === '') {
      issues.push({ path: 'lowStockThreshold', code: 'threshold-needs-stock' });
    }
  }

  if (values.stockUnit.trim().length > MEDICATION_LIMITS.doseUnit) {
    issues.push({ path: 'stockUnit', code: 'stock-unit-too-long' });
  }

  return issues;
}

export interface MedicationFormFields {
  name: string;
  /** `null` when none is chosen. */
  dosageForm: DosageForm | null;
  doseUnit: string;
  /**
   * The dose unit exactly as the form held it, untrimmed. When it equals the stored unit the
   * medication keeps its stored text byte for byte (a unit saved as `Tabletka ` is not rewritten
   * by saving something else).
   */
  doseUnitAsEntered: string;
  /** `null` when no strength is given. */
  strength: MedicationStrength | null;
  notes: string | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
  scheduleTimes: { scheduleTimeId: string; timeOfDay: LocalTime; doseAmount: number }[];
  /** `null` when no stock information was given. */
  stockQuantity: number | null;
  /**
   * The stock unit exactly as the form held it, or `null` when it was left empty (then the dose
   * unit is used). Untrimmed, so that an unchanged stored unit can be recognised byte for byte.
   */
  stockUnit: string | null;
  /** `null` when there is no own threshold. */
  lowStockThreshold: number | null;
  /** The unit of a stored threshold that was left as it was; `null` for one typed now (the stock unit). */
  lowStockThresholdUnit: string | null;
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

  const strengthNumber =
    values.strengthValue.trim() === '' ? null : parseQuantityInput(values.strengthValue);
  const strength: MedicationStrength | null =
    strengthNumber === null ? null : { value: strengthNumber, unit: values.strengthUnit };

  const notes = values.notes.trim();
  return {
    name: values.name.trim(),
    dosageForm: isDosageForm(values.dosageForm) ? values.dosageForm : null,
    doseUnit: values.doseUnit.trim(),
    doseUnitAsEntered: values.doseUnit,
    strength,
    notes: notes === '' ? null : notes,
    startDate,
    endDate,
    scheduleTimes,
    stockQuantity,
    stockUnit: values.stockUnit.trim() === '' ? null : values.stockUnit,
    lowStockThreshold:
      values.lowStockThreshold.trim() === '' ? null : parseQuantityInput(values.lowStockThreshold),
    lowStockThresholdUnit:
      values.lowStockThresholdUnit === '' ? null : values.lowStockThresholdUnit,
  };
}
