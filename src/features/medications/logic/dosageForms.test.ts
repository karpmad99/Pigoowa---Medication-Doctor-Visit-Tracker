import { describe, expect, it } from 'vitest';
import {
  DOSAGE_FORMS,
  isDosageForm,
  isOutsideList,
  isStrengthUnit,
  listedUnits,
  OUTSIDE_LIST_LABEL,
  STRENGTH_UNITS,
  unitChoices,
} from './dosageForms';
import { formatAmount } from './unitForms';

describe('the lists', () => {
  it('has the ten forms of the specification', () => {
    expect(DOSAGE_FORMS.map((form) => form.value)).toEqual([
      'tablet',
      'capsule',
      'liquid',
      'drops',
      'injection',
      'sachet',
      'patch',
      'suppository',
      'inhaler',
      'other',
    ]);
  });

  it.each([
    ['tablet', ['tabletka'], ['tabletka']],
    ['capsule', ['kapsułka'], ['kapsułka']],
    ['liquid', ['ml'], ['ml']],
    ['drops', ['kropla'], ['kropla', 'ml']],
    ['injection', ['ampułka', 'wstrzyknięcie', 'ml'], ['ampułka', 'wstrzyknięcie', 'ml']],
    ['sachet', ['saszetka'], ['saszetka']],
    ['patch', ['plaster'], ['plaster']],
    ['suppository', ['czopek'], ['czopek']],
    ['inhaler', ['dawka'], ['dawka']],
    ['other', [], []],
  ] as const)('offers for "%s" the dose units %j and the stock units %j', (form, dose, stock) => {
    expect(listedUnits(form, 'dose')).toEqual(dose);
    expect(listedUnits(form, 'stock')).toEqual(stock);
  });

  it('offers nothing when no form is chosen: the unit is typed', () => {
    expect(listedUnits(null, 'dose')).toEqual([]);
    expect(listedUnits(null, 'stock')).toEqual([]);
  });

  it('has only the strength units of the specification, and none of them is a dose or stock unit', () => {
    expect(STRENGTH_UNITS).toEqual(['mg', 'mcg', 'g', 'IU', 'mg/ml', 'mcg/ml', '%']);
    for (const form of DOSAGE_FORMS) {
      for (const unit of [
        ...listedUnits(form.value, 'dose'),
        ...listedUnits(form.value, 'stock'),
      ]) {
        expect(STRENGTH_UNITS).not.toContain(unit);
      }
    }
  });

  it('keeps every listed unit one that the amount formatting knows how to read', () => {
    for (const form of DOSAGE_FORMS) {
      for (const unit of listedUnits(form.value, 'stock')) {
        expect(formatAmount(2, unit)).toMatch(new RegExp(`^2 `));
      }
    }
  });

  it('recognises only real forms and strength units', () => {
    expect(isDosageForm('tablet')).toBe(true);
    expect(isDosageForm('powder')).toBe(false);
    expect(isDosageForm('')).toBe(false);
    expect(isDosageForm(undefined)).toBe(false);
    expect(isStrengthUnit('mg/ml')).toBe(true);
    expect(isStrengthUnit('tabletka')).toBe(false);
    expect(isStrengthUnit('MG')).toBe(false);
  });
});

describe('unitChoices', () => {
  const tablet = ['tabletka'];

  it('lists the units of the form, with the current one selected', () => {
    expect(unitChoices(tablet, null, 'tabletka')).toEqual({
      choices: [{ value: 'tabletka', label: 'tabletka', outsideList: false }],
      selected: 'tabletka',
    });
  });

  it('selects nothing for an empty current unit', () => {
    expect(unitChoices(tablet, null, '').selected).toBeNull();
  });

  it('puts a stored unit that is not on the list FIRST, as stored, labelled as outside the list', () => {
    const { choices, selected } = unitChoices(['dawka'], 'inhalacja', 'inhalacja');

    expect(choices).toEqual([
      { value: 'inhalacja', label: `inhalacja (${OUTSIDE_LIST_LABEL})`, outsideList: true },
      { value: 'dawka', label: 'dawka', outsideList: false },
    ]);
    expect(selected).toBe('inhalacja');
  });

  it('keeps the stored text exactly (spaces, case) as the value of that option', () => {
    const { choices } = unitChoices(['dawka'], ' Inhalacja ', ' Inhalacja ');

    expect(choices[0]?.value).toBe(' Inhalacja ');
    expect(choices[0]?.label).toBe(`Inhalacja (${OUTSIDE_LIST_LABEL})`);
  });

  it('does not offer the stored unit as outside the list when it is the listed one in other writing', () => {
    const { choices, selected } = unitChoices(tablet, 'Tabletka ', 'Tabletka ');

    expect(choices.map((choice) => choice.value)).toEqual(['tabletka']);
    expect(choices.some((choice) => choice.outsideList)).toBe(false);
    // Shown as selected for convenience; the stored text is changed only by picking.
    expect(selected).toBe('tabletka');
  });

  it('offers no outside-list option when nothing was stored (a new medication)', () => {
    expect(unitChoices(tablet, null, '').choices.some((choice) => choice.outsideList)).toBe(false);
    expect(unitChoices(tablet, '', '').choices).toHaveLength(1);
  });

  it('never replaces the stored unit by a listed one: a unit that is not offered selects nothing', () => {
    expect(unitChoices(tablet, null, 'ml').selected).toBeNull();
  });

  it('is only about the stored unit: another unit picked meanwhile is not offered as outside the list', () => {
    const { choices } = unitChoices(['ml'], 'tabletka', 'ml');

    expect(choices.map((choice) => choice.value)).toEqual(['tabletka', 'ml']);
    expect(unitChoices(['ml'], 'ml', 'ml').choices.map((choice) => choice.value)).toEqual(['ml']);
  });
});

describe('isOutsideList', () => {
  it('is true only when a form with a list is set and the unit is not on it', () => {
    expect(isOutsideList('tablet', 'kapsułka', 'dose')).toBe(true);
    expect(isOutsideList('tablet', 'Tabletka ', 'dose')).toBe(false);
    expect(isOutsideList('drops', 'ml', 'dose')).toBe(true);
    expect(isOutsideList('drops', 'ml', 'stock')).toBe(false);
  });

  it('is false with no form and with "other": there is no list to be outside of', () => {
    expect(isOutsideList(undefined, 'cokolwiek', 'dose')).toBe(false);
    expect(isOutsideList('other', 'cokolwiek', 'dose')).toBe(false);
  });
});
