import type { DosageForm } from '../types';
import { unitsMatch } from './units';

// The dosage forms and the units the form offers for each (PROJECT_SPEC DEC-45 and §7.6). The
// stored value of a unit stays the plain Polish noun already used by `unitForms.ts`, so units
// saved earlier are valid without being rewritten. Nothing here converts between units and nothing
// here is read by a calculation: the lists only decide what a person is offered.

export const DOSAGE_FORMS: readonly { value: DosageForm; label: string }[] = [
  { value: 'tablet', label: 'Tabletki' },
  { value: 'capsule', label: 'Kapsułki' },
  { value: 'liquid', label: 'Płyn (syrop, roztwór)' },
  { value: 'drops', label: 'Krople' },
  { value: 'injection', label: 'Zastrzyki, ampułki' },
  { value: 'sachet', label: 'Saszetki' },
  { value: 'patch', label: 'Plastry' },
  { value: 'suppository', label: 'Czopki' },
  { value: 'inhaler', label: 'Inhalator' },
  { value: 'other', label: 'Inna postać' },
];

const DOSE_UNITS: Record<DosageForm, readonly string[]> = {
  tablet: ['tabletka'],
  capsule: ['kapsułka'],
  liquid: ['ml'],
  drops: ['kropla'],
  injection: ['ampułka', 'wstrzyknięcie', 'ml'],
  sachet: ['saszetka'],
  patch: ['plaster'],
  suppository: ['czopek'],
  inhaler: ['dawka'],
  other: [],
};

// Drops may be counted in millilitres (a bottle): then no estimate is possible, because drops and
// millilitres are never converted. The form says so at once.
const STOCK_UNITS: Record<DosageForm, readonly string[]> = {
  ...DOSE_UNITS,
  drops: ['kropla', 'ml'],
};

/** Units of strength, as printed on a package. A strength is never offered as a dose or stock unit. */
export const STRENGTH_UNITS: readonly string[] = ['mg', 'mcg', 'g', 'IU', 'mg/ml', 'mcg/ml', '%'];

const DOSAGE_FORM_VALUES: ReadonlySet<string> = new Set(DOSAGE_FORMS.map((form) => form.value));

export function isDosageForm(value: unknown): value is DosageForm {
  return typeof value === 'string' && DOSAGE_FORM_VALUES.has(value);
}

export function isStrengthUnit(value: unknown): value is string {
  return typeof value === 'string' && STRENGTH_UNITS.includes(value);
}

export function dosageFormLabel(form: DosageForm): string {
  return DOSAGE_FORMS.find((entry) => entry.value === form)?.label ?? form;
}

/** The units offered for a form; empty for "other" and for no form (the unit is then typed). */
export function listedUnits(form: DosageForm | null, kind: 'dose' | 'stock'): readonly string[] {
  if (form === null) return [];
  return (kind === 'dose' ? DOSE_UNITS : STOCK_UNITS)[form];
}

export interface UnitChoice {
  /** What is stored when this option is picked: the listed unit, or the old text exactly as stored. */
  value: string;
  label: string;
  /** True for the stored unit that is not on the list. */
  outsideList: boolean;
}

export interface UnitChoices {
  choices: UnitChoice[];
  /**
   * The option to show as selected for `current`. It can differ from `current` only in writing
   * (`Tabletka ` shows the listed `tabletka`): the stored text changes only when a person picks.
   * `null` when `current` is empty or is a unit that is not offered (nothing is selected then).
   */
  selected: string | null;
}

/** The label that marks the old unit that is not on the list. */
export const OUTSIDE_LIST_LABEL = 'dotychczasowa, spoza listy';

/**
 * The options of a unit selector.
 * - `listed` are the units of the chosen form.
 * - `stored` is the unit saved with the medication when the form was opened (not what is typed
 *   now): if it is not on the list it is the FIRST option, written as stored and labelled as
 *   outside the list. It stays selectable while the form is open; after another unit is saved it
 *   is no longer the stored one and so no longer offered.
 * Nothing is replaced: a stored unit is never swapped for a listed one by this function.
 */
export function unitChoices(
  listed: readonly string[],
  stored: string | null,
  current: string,
): UnitChoices {
  const choices: UnitChoice[] = [];
  const storedText = stored?.trim() ?? '';
  const matchesListed = storedText !== '' && listed.some((unit) => unitsMatch(unit, storedText));
  if (stored !== null && storedText !== '' && !matchesListed) {
    choices.push({
      value: stored,
      label: `${storedText} (${OUTSIDE_LIST_LABEL})`,
      outsideList: true,
    });
  }
  for (const unit of listed) choices.push({ value: unit, label: unit, outsideList: false });

  const exact = choices.find((choice) => choice.value === current);
  if (exact !== undefined) return { choices, selected: exact.value };
  const sameUnit = choices.find((choice) => unitsMatch(choice.value, current));
  return { choices, selected: sameUnit?.value ?? null };
}

/** True when a form has a list and this unit is not on it (for the neutral label on a card). */
export function isOutsideList(
  form: DosageForm | undefined,
  unit: string,
  kind: 'dose' | 'stock',
): boolean {
  if (form === undefined) return false;
  const listed = listedUnits(form, kind);
  return listed.length > 0 && !listed.some((entry) => unitsMatch(entry, unit));
}
