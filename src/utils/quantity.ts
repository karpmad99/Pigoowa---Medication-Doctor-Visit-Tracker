// Amounts of medication (doses, stock) are plain numbers, limited to what the database column
// `numeric(10,3)` can store: at most 3 decimal places and a bounded size. Arithmetic is done on
// whole thousandths so that 0.1 + 0.2 style floating-point errors cannot leak into results.

export const QUANTITY_DECIMALS = 3;
export const MAX_QUANTITY = 9_999_999.999;

const THOUSANDTHS = 10 ** QUANTITY_DECIMALS;

/** The amount as a whole number of thousandths (1.5 -> 1500). */
export function toThousandths(value: number): number {
  return Math.round(value * THOUSANDTHS);
}

export function fromThousandths(thousandths: number): number {
  return thousandths / THOUSANDTHS;
}

/** True for a finite number with at most 3 decimals, not above `MAX_QUANTITY`, and positive (or zero, if allowed). */
export function isValidQuantity(value: number, options: { allowZero: boolean }): boolean {
  if (!Number.isFinite(value) || value > MAX_QUANTITY) return false;
  if (value < 0 || (value === 0 && !options.allowZero)) return false;
  return fromThousandths(toThousandths(value)) === value;
}
