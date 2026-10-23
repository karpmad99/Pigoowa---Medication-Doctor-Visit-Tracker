import { describe, expect, it } from 'vitest';
import { DOSE_NOTE_MAX } from './limits';
import { isPlannedAmount, parseTakenDetails } from './takenDetails';

describe('parseTakenDetails', () => {
  it('reads an amount and a note, trimming the note', () => {
    expect(parseTakenDetails({ amountText: '2', noteText: '  Zgodnie z zaleceniem  ' })).toEqual({
      ok: true,
      takenAmount: 2,
      note: 'Zgodnie z zaleceniem',
    });
  });

  it.each([
    ['1', 1],
    ['0,5', 0.5],
    ['12.25', 12.25],
    [' 3 ', 3],
    ['0,001', 0.001],
    ['9999999,999', 9_999_999.999],
    ['100', 100],
  ])(
    'accepts the amount "%s" (%s): larger or smaller than any plan, it does not matter',
    (amountText, amount) => {
      const result = parseTakenDetails({ amountText, noteText: '' });

      expect(result.ok && result.takenAmount).toBe(amount);
    },
  );

  it('knows nothing about the plan, so a difference from it can never be a reason to refuse', () => {
    expect(parseTakenDetails.length).toBe(1);
    expect(parseTakenDetails({ amountText: '50', noteText: '' }).ok).toBe(true);
    expect(parseTakenDetails({ amountText: '0,001', noteText: '' }).ok).toBe(true);
  });

  it.each([
    '',
    '  ',
    '0',
    '0,0',
    '-1',
    '-0,5',
    'abc',
    '1e3',
    '1,2345',
    '10000000',
    '1 000',
    ',5',
    '2,',
  ])('refuses the amount "%s", and only for the amount', (amountText) => {
    expect(parseTakenDetails({ amountText, noteText: '' })).toEqual({
      ok: false,
      issues: ['amount-invalid'],
    });
  });

  it('turns an empty or blank note into null, and keeps a note of exactly the limit', () => {
    const empty = parseTakenDetails({ amountText: '1', noteText: '   ' });
    const limit = parseTakenDetails({ amountText: '1', noteText: 'x'.repeat(DOSE_NOTE_MAX) });
    const padded = parseTakenDetails({
      amountText: '1',
      noteText: `  ${'x'.repeat(DOSE_NOTE_MAX)}  `,
    });

    expect(empty.ok && empty.note).toBeNull();
    expect(limit.ok).toBe(true);
    expect(padded.ok).toBe(true); // the limit is counted after trimming
  });

  it('refuses a note over the limit, together with a bad amount if both are wrong', () => {
    expect(parseTakenDetails({ amountText: '1', noteText: 'x'.repeat(DOSE_NOTE_MAX + 1) })).toEqual(
      {
        ok: false,
        issues: ['note-too-long'],
      },
    );
    expect(parseTakenDetails({ amountText: '0', noteText: 'x'.repeat(DOSE_NOTE_MAX + 1) })).toEqual(
      {
        ok: false,
        issues: ['amount-invalid', 'note-too-long'],
      },
    );
  });
});

describe('isPlannedAmount', () => {
  it('compares in whole thousandths', () => {
    expect(isPlannedAmount(1, 1)).toBe(true);
    expect(isPlannedAmount(0.1 + 0.2, 0.3)).toBe(true);
    expect(isPlannedAmount(1.001, 1)).toBe(false);
    expect(isPlannedAmount(2, 1)).toBe(false);
    expect(isPlannedAmount(0.5, 1)).toBe(false);
  });
});
