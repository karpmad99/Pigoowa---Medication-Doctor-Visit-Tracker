import { describe, expect, it } from 'vitest';
import { isValidQuantity, parseQuantityInput } from './quantity';

describe('parseQuantityInput', () => {
  it.each([
    ['1', 1],
    ['0', 0],
    ['0,5', 0.5],
    ['0.5', 0.5],
    ['  2  ', 2],
    ['1,234', 1.234],
    ['120', 120],
    ['9999999,999', 9_999_999.999],
  ])('reads %j as %s', (text, expected) => {
    expect(parseQuantityInput(text)).toBe(expected);
  });

  it.each([
    ['empty text', ''],
    ['only spaces', '   '],
    ['letters', 'abc'],
    ['a number followed by text', '2 tabletki'],
    ['a negative number', '-1'],
    ['a plus sign', '+1'],
    ['exponent notation', '1e3'],
    ['a hexadecimal number', '0x10'],
    ['a thousands separator', '1 000'],
    ['two separators', '1.2.3'],
    ['a trailing separator', '1,'],
    ['a leading separator', ',5'],
    ['four decimals', '1,2345'],
    ['too many digits', '12345678'],
    ['infinity', 'Infinity'],
    ['not-a-number', 'NaN'],
  ])('rejects %s', (_label, text) => {
    expect(parseQuantityInput(text)).toBeNull();
  });
});

describe('isValidQuantity', () => {
  it('requires a positive number unless zero is allowed', () => {
    expect(isValidQuantity(0, { allowZero: false })).toBe(false);
    expect(isValidQuantity(0, { allowZero: true })).toBe(true);
    expect(isValidQuantity(0.001, { allowZero: false })).toBe(true);
    expect(isValidQuantity(-1, { allowZero: true })).toBe(false);
  });

  it('rejects more than three decimals, huge values and non-finite numbers', () => {
    expect(isValidQuantity(0.0001, { allowZero: false })).toBe(false);
    expect(isValidQuantity(10_000_000, { allowZero: false })).toBe(false);
    expect(isValidQuantity(Number.NaN, { allowZero: true })).toBe(false);
    expect(isValidQuantity(Number.POSITIVE_INFINITY, { allowZero: true })).toBe(false);
  });
});
