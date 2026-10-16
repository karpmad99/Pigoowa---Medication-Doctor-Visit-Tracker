import type { Id, LocalDate, Timestamp } from '@/types/primitives';
import { compareLocalDates } from '@/utils/date';
import type { Medication, MedicationStock, ScheduleTime } from '../types';
import type { MedicationFormFields } from './medicationForm';
import { applyScheduleChange } from './schedule';
import { buildMedicationStock } from './stock';

export interface SaveMedicationContext {
  now: Timestamp;
  /** Today in the user's time zone; a schedule change takes effect from this day. */
  today: LocalDate;
  /** Creates ids for new schedule times. */
  createId: () => Id;
}

export type SaveMedicationResult =
  { ok: true; medication: Medication } | { ok: false; error: 'invalid-stock' };

function toScheduleTimes(fields: MedicationFormFields, createId: () => Id): ScheduleTime[] {
  return fields.scheduleTimes.map((row) => ({
    // A row that came from a stored schedule time keeps its id; a new row gets a fresh one.
    id: row.scheduleTimeId === '' ? createId() : row.scheduleTimeId,
    timeOfDay: row.timeOfDay,
    doseAmount: row.doseAmount,
  }));
}

function stockOf(
  fields: MedicationFormFields,
  previous: MedicationStock | null,
  now: Timestamp,
): { ok: true; stock: MedicationStock | null } | { ok: false } {
  if (fields.stockQuantity === null) return { ok: true, stock: null };
  // The quantity was not touched: keep the stored stock exactly as it was, including WHEN it was
  // counted (`asOf`). Resetting that moment would change which taken doses count against it.
  if (previous !== null && previous.quantity === fields.stockQuantity) {
    return { ok: true, stock: previous };
  }
  const built = buildMedicationStock(
    { quantity: fields.stockQuantity, unit: fields.doseUnit },
    now,
  );
  return built.ok ? { ok: true, stock: built.stock } : { ok: false };
}

/** A new medication from a validated form. The schedule takes effect from the start date. */
export function createMedicationFromForm(
  fields: MedicationFormFields,
  context: SaveMedicationContext & { id: Id },
): SaveMedicationResult {
  const stock = stockOf(fields, null, context.now);
  if (!stock.ok) return { ok: false, error: 'invalid-stock' };
  return {
    ok: true,
    medication: {
      id: context.id,
      name: fields.name,
      doseUnit: fields.doseUnit,
      notes: fields.notes,
      startDate: fields.startDate,
      endDate: fields.endDate,
      scheduleEffectiveFrom: fields.startDate,
      scheduleTimes: toScheduleTimes(fields, context.createId),
      stock: stock.stock,
      createdAt: context.now,
      updatedAt: context.now,
    },
  };
}

/**
 * The medication as it should be stored after editing it with a validated form. Rules:
 * - `scheduleEffectiveFrom` moves to today ONLY if the schedule really changes
 *   (`applyScheduleChange`); renaming, or changing notes or stock, never touches it.
 * - Moving the start date keeps `scheduleEffectiveFrom` valid (never before the start). If the
 *   schedule has never been changed (the effective date still equals the start date), the
 *   effective date follows the start date, so starting earlier also plans the earlier days.
 * - `id` and `createdAt` never change; intake history is not part of the medication at all, so
 *   editing cannot rewrite it (records keep the amount and unit they were recorded with).
 * - Stock keeps its counting moment unless the quantity itself was changed.
 */
export function applyMedicationEdit(
  existing: Medication,
  fields: MedicationFormFields,
  context: SaveMedicationContext,
): SaveMedicationResult {
  const stock = stockOf(fields, existing.stock, context.now);
  if (!stock.ok) return { ok: false, error: 'invalid-stock' };

  let effectiveFrom = existing.scheduleEffectiveFrom;
  if (fields.startDate !== existing.startDate) {
    const followsStart = effectiveFrom === existing.startDate;
    effectiveFrom =
      followsStart || compareLocalDates(effectiveFrom, fields.startDate) < 0
        ? fields.startDate
        : effectiveFrom;
  }

  const withNewDetails: Medication = {
    ...existing,
    name: fields.name,
    doseUnit: fields.doseUnit,
    notes: fields.notes,
    startDate: fields.startDate,
    endDate: fields.endDate,
    scheduleEffectiveFrom: effectiveFrom,
    stock: stock.stock,
  };
  const withNewSchedule = applyScheduleChange(
    withNewDetails,
    toScheduleTimes(fields, context.createId),
    context.today,
    context.now,
  );
  return { ok: true, medication: { ...withNewSchedule, updatedAt: context.now } };
}
