import { describe, expect, it } from 'vitest';
import { asLocalDate, asTimestamp } from './date';
import { formatLocalDate, formatQuantity, formatTimestamp } from './format';

describe('formatLocalDate', () => {
  it('writes the weekday and the month name in Polish', () => {
    expect(formatLocalDate(asLocalDate('2026-10-15'))).toBe('czwartek, 15 października 2026');
    expect(formatLocalDate(asLocalDate('2026-03-01'))).toBe('niedziela, 1 marca 2026');
  });

  it('shows the stored day, whatever the machine time zone', () => {
    expect(formatLocalDate(asLocalDate('2026-01-01'))).toBe('czwartek, 1 stycznia 2026');
    expect(formatLocalDate(asLocalDate('2024-02-29'))).toBe('czwartek, 29 lutego 2024');
  });
});

describe('formatTimestamp', () => {
  it('shows the wall clock of the given zone, in 24-hour time', () => {
    const instant = asTimestamp('2026-10-15T10:30:00Z');

    expect(formatTimestamp(instant, 'Europe/Warsaw')).toBe('15 października 2026 12:30');
    expect(formatTimestamp(instant, 'UTC')).toBe('15 października 2026 10:30');
  });

  it('writes midnight as 00:00 rather than 24:00', () => {
    expect(formatTimestamp(asTimestamp('2026-01-15T23:00:00Z'), 'Europe/Warsaw')).toBe(
      '16 stycznia 2026 00:00',
    );
  });
});

describe('formatQuantity', () => {
  it('uses the Polish decimal comma and drops trailing zeros', () => {
    expect(formatQuantity(1.5)).toBe('1,5');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(0.125)).toBe('0,125');
  });
});
