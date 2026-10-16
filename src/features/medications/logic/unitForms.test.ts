import { describe, expect, it } from 'vitest';
import { formatAmount } from './unitForms';

describe('formatAmount', () => {
  it.each([
    [1, '1 tabletka'],
    [2, '2 tabletki'],
    [4, '4 tabletki'],
    [5, '5 tabletek'],
    [12, '12 tabletek'],
    [22, '22 tabletki'],
    [28, '28 tabletek'],
    [0, '0 tabletek'],
    [0.5, '0,5 tabletki'],
    [1.5, '1,5 tabletki'],
  ])('inflects "tabletka" for %s', (quantity, expected) => {
    expect(formatAmount(quantity, 'tabletka')).toBe(expected);
  });

  it('knows other common unit words', () => {
    expect(formatAmount(1, 'kapsułka')).toBe('1 kapsułka');
    expect(formatAmount(3, 'kapsułka')).toBe('3 kapsułki');
    expect(formatAmount(10, 'kropla')).toBe('10 kropli');
    expect(formatAmount(3, 'kropla')).toBe('3 krople');
    expect(formatAmount(2, 'plaster')).toBe('2 plastry');
    expect(formatAmount(5, 'plaster')).toBe('5 plastrów');
  });

  it('writes units that never change the same way for every number', () => {
    expect(formatAmount(5, 'ml')).toBe('5 ml');
    expect(formatAmount(0.5, 'mg')).toBe('0,5 mg');
    expect(formatAmount(120, 'ml')).toBe('120 ml');
  });

  it('recognises a unit regardless of case and surrounding spaces', () => {
    expect(formatAmount(2, '  Tabletka ')).toBe('2 tabletki');
    expect(formatAmount(2, 'ML')).toBe('2 ml');
  });

  it('shows an unrecognised unit exactly as typed instead of guessing its grammar', () => {
    expect(formatAmount(2, 'inhalacja')).toBe('2 inhalacja');
    expect(formatAmount(1, ' Wziewy ')).toBe('1 Wziewy');
  });

  it('is not fooled by unit names that are also properties of plain objects', () => {
    expect(formatAmount(2, 'constructor')).toBe('2 constructor');
    expect(formatAmount(2, '__proto__')).toBe('2 __proto__');
    expect(formatAmount(2, 'toString')).toBe('2 toString');
  });
});
