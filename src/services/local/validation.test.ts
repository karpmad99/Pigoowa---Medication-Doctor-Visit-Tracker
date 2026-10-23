import { describe, expect, it } from 'vitest';
import { makeDoseLog, makeMedication, makeStockEvent } from '@/test/fixtures';
import { asTimestamp } from '@/utils/date';
import { validateDoseLog, validateMedication, validateStockEvent } from './validation';

const failedAt = (result: ReturnType<typeof validateStockEvent>) =>
  result.ok ? null : result.path;

describe('validateStockEvent', () => {
  it('accepts a valid event and returns a copy with the same values', () => {
    const event = makeStockEvent({ note: 'Notatka' });

    const result = validateStockEvent(event);

    expect(result).toEqual({ ok: true, value: event });
    expect(result.ok && result.value).not.toBe(event);
  });

  it('accepts a waste event and a reversed one', () => {
    expect(validateStockEvent(makeStockEvent({ kind: 'waste' })).ok).toBe(true);
    expect(
      validateStockEvent(makeStockEvent({ reversedAt: asTimestamp('2026-10-10T08:00:00Z') })).ok,
    ).toBe(true);
  });

  it('accepts a note of 500 characters counted after trimming, and a unit written freely', () => {
    expect(validateStockEvent(makeStockEvent({ note: `  ${'x'.repeat(500)}  ` })).ok).toBe(true);
    expect(validateStockEvent(makeStockEvent({ unit: 'Opakowanie ' })).ok).toBe(true);
  });

  it.each([
    ['not an object', 'text', 'stockEvent'],
    ['null', null, 'stockEvent'],
    ['an array', [], 'stockEvent'],
  ])('refuses %s', (_label, input, path) => {
    expect(failedAt(validateStockEvent(input))).toBe(path);
  });

  it.each([
    ['id', { id: '' }],
    ['medicationId', { medicationId: ' ' }],
    ['kind', { kind: 'gift' }],
    ['amount', { amount: 0 }],
    ['amount', { amount: -1 }],
    ['amount', { amount: 1.2345 }],
    ['amount', { amount: '5' }],
    ['unit', { unit: '' }],
    ['unit', { unit: 'x'.repeat(31) }],
    ['recordedAt', { recordedAt: 'wczoraj' }],
    ['note', { note: 'x'.repeat(501) }],
    ['note', { note: undefined }],
    ['reversedAt', { reversedAt: undefined }],
    ['reversedAt', { reversedAt: 'wczoraj' }],
    ['reversedAt', { reversedAt: '2026-10-01T00:00:00.000Z' }],
  ])('names the field when %s is wrong, and never the value', (field, overrides) => {
    const result = validateStockEvent({ ...makeStockEvent(), ...overrides }, 'events[3]');

    expect(failedAt(result)).toBe(`events[3].${field}`);
    expect(JSON.stringify(result)).not.toContain('wczoraj');
  });

  it('refuses an event whose required field is missing altogether', () => {
    const withoutNote: Record<string, unknown> = { ...makeStockEvent() };
    delete withoutNote.note;

    expect(failedAt(validateStockEvent(withoutNote))).toBe('stockEvent.note');
  });

  it('drops unknown fields: the copy has only the known ones', () => {
    const result = validateStockEvent({ ...makeStockEvent(), secret: 'x' });

    expect(result.ok && 'secret' in result.value).toBe(false);
  });
});

describe('validateMedication: the stock basis', () => {
  const stock = { quantity: 5, unit: 'tabletka', asOf: '2026-10-01T08:00:00.000Z' };

  it('keeps an absent basis absent (older data is not rewritten)', () => {
    const result = validateMedication({ ...makeMedication(), stock });

    expect(result.ok && result.value.stock && 'basis' in result.value.stock).toBe(false);
  });

  it.each(['counted', 'new-package'])('accepts the basis "%s" and keeps it', (basis) => {
    const result = validateMedication({ ...makeMedication(), stock: { ...stock, basis } });

    expect(result.ok && result.value.stock?.basis).toBe(basis);
  });

  it.each(['guessed', '', null, 5])('refuses the basis %j', (basis) => {
    const result = validateMedication({ ...makeMedication(), stock: { ...stock, basis } });

    expect(result.ok ? null : result.path).toBe('medication.stock.basis');
  });
});

describe('validateDoseLog: the amount actually taken and the note', () => {
  const pathOf = (input: unknown) => {
    const result = validateDoseLog(input, 'logs[1]');
    return result.ok ? null : result.path;
  };

  it('keeps absent fields absent (a record saved before them is not rewritten)', () => {
    const result = validateDoseLog(makeDoseLog());

    expect(result.ok && 'takenAmount' in result.value).toBe(false);
    expect(result.ok && 'note' in result.value).toBe(false);
  });

  it('keeps an amount taken and a note on a taken dose, larger or smaller than the plan', () => {
    for (const takenAmount of [0.001, 0.5, 1, 2, 100]) {
      const result = validateDoseLog(makeDoseLog({ doseAmount: 1, takenAmount, note: 'Notatka' }));

      expect(result.ok && result.value).toMatchObject({
        doseAmount: 1,
        takenAmount,
        note: 'Notatka',
      });
    }
  });

  it('accepts a null note (none), and a note of exactly 500 characters counted after trimming', () => {
    expect(validateDoseLog(makeDoseLog({ note: null })).ok).toBe(true);
    expect(validateDoseLog(makeDoseLog({ note: `  ${'x'.repeat(500)}  ` })).ok).toBe(true);
  });

  it.each([
    ['takenAmount', { takenAmount: 0 }],
    ['takenAmount', { takenAmount: -2 }],
    ['takenAmount', { takenAmount: 1.2345 }],
    ['takenAmount', { takenAmount: '2' }],
    ['takenAmount', { takenAmount: null }],
    ['note', { note: 'x'.repeat(501) }],
    ['note', { note: 7 }],
  ])('names the field when the %s is wrong', (field, overrides) => {
    expect(pathOf({ ...makeDoseLog(), ...overrides })).toBe(`logs[1].${field}`);
  });

  it('refuses an amount taken or a note on a skipped dose, but accepts a null note there', () => {
    expect(pathOf({ ...makeDoseLog({ status: 'skipped' }), takenAmount: 2 })).toBe(
      'logs[1].takenAmount',
    );
    expect(pathOf({ ...makeDoseLog({ status: 'skipped' }), note: 'x' })).toBe('logs[1].note');
    expect(validateDoseLog(makeDoseLog({ status: 'skipped', note: null })).ok).toBe(true);
  });

  it('never puts the stored text in the report', () => {
    const result = validateDoseLog({ ...makeDoseLog(), note: 'tajna notatka '.repeat(60) });

    expect(JSON.stringify(result)).not.toContain('tajna');
  });
});
