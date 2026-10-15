import { describe, expect, it } from 'vitest';
import { normalizeUnit, unitsMatch } from './units';

describe('unitsMatch', () => {
  it('ignores case and surrounding or repeated spaces', () => {
    expect(unitsMatch('tabletka', 'Tabletka ')).toBe(true);
    expect(unitsMatch('  krople  ', 'krople')).toBe(true);
    expect(unitsMatch('ml  dziennie', 'ML dziennie')).toBe(true);
  });

  it('treats different units as different, with no conversion', () => {
    expect(unitsMatch('mg', 'ml')).toBe(false);
    expect(unitsMatch('tabletka', 'kapsułka')).toBe(false);
    expect(unitsMatch('mg', 'g')).toBe(false);
  });

  it('never matches a blank unit, even against another blank one', () => {
    expect(unitsMatch('', '')).toBe(false);
    expect(unitsMatch('   ', 'tabletka')).toBe(false);
  });

  it('normalises Polish capital letters', () => {
    expect(normalizeUnit('  ŁYŻKA ')).toBe('łyżka');
  });
});
