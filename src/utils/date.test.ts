import { describe, expect, it } from 'vitest';
import {
  addDays,
  asLocalDate,
  asLocalTime,
  asTimestamp,
  compareLocalDates,
  compareLocalTimes,
  compareTimestamps,
  daysInMonth,
  isLeapYear,
  parseLocalDate,
  parseLocalTime,
  parseTimestamp,
} from './date';

describe('parseLocalDate', () => {
  it('accepts real calendar dates', () => {
    expect(parseLocalDate('2026-10-15')).toBe('2026-10-15');
    expect(parseLocalDate('2026-12-31')).toBe('2026-12-31');
  });

  it.each([
    ['impossible day', '2026-02-30'],
    ['day zero', '2026-05-00'],
    ['month 13', '2026-13-01'],
    ['month zero', '2026-00-10'],
    ['31st of a 30-day month', '2026-04-31'],
    ['29 February in a non-leap year', '2026-02-29'],
    ['century year that is not a leap year', '2100-02-29'],
    ['wrong separator', '2026/10/15'],
    ['missing zero padding', '2026-1-5'],
    ['time attached', '2026-10-15T00:00'],
    ['surrounding whitespace', ' 2026-10-15'],
    ['trailing newline', '2026-10-15\n'],
    ['empty string', ''],
    ['year before the supported range', '1899-12-31'],
    ['year after the supported range', '3000-01-01'],
  ])('rejects %s', (_label, input) => {
    expect(parseLocalDate(input)).toBeNull();
  });

  it('accepts 29 February in leap years, including 2000 but not 1900 or 2100', () => {
    expect(parseLocalDate('2024-02-29')).not.toBeNull();
    expect(parseLocalDate('2000-02-29')).not.toBeNull();
    expect(parseLocalDate('1900-02-29')).toBeNull();
  });
});

describe('leap years and month lengths', () => {
  it('follows the Gregorian rules', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
  });

  it('knows the length of each kind of month', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('parseLocalTime', () => {
  it.each(['00:00', '08:05', '12:00', '23:59'])('accepts %s', (input) => {
    expect(parseLocalTime(input)).toBe(input);
  });

  it.each([
    ['24:00', '24:00'],
    ['hour 25', '25:30'],
    ['minute 60', '08:60'],
    ['missing zero padding', '8:05'],
    ['seconds attached', '08:05:00'],
    ['12-hour suffix', '08:05 PM'],
    ['wrong separator', '08.05'],
    ['empty string', ''],
  ])('rejects %s', (_label, input) => {
    expect(parseLocalTime(input)).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('normalises an offset timestamp to UTC', () => {
    expect(parseTimestamp('2026-10-15T10:30:00+02:00')).toBe('2026-10-15T08:30:00.000Z');
    expect(parseTimestamp('2026-10-15T08:30:00Z')).toBe('2026-10-15T08:30:00.000Z');
  });

  it('accepts the microsecond precision that Postgres returns', () => {
    expect(parseTimestamp('2026-10-15T08:30:00.123456+00:00')).toBe('2026-10-15T08:30:00.123Z');
  });

  it.each([
    ['no offset (ambiguous)', '2026-10-15T08:30:00'],
    ['impossible date', '2026-02-30T08:30:00Z'],
    ['hour 24', '2026-10-15T24:00:00Z'],
    ['leap second', '2026-10-15T08:30:60Z'],
    ['date only', '2026-10-15'],
    ['space instead of T', '2026-10-15 08:30:00Z'],
    ['garbage', 'not a time'],
  ])('rejects %s', (_label, input) => {
    expect(parseTimestamp(input)).toBeNull();
  });
});

describe('throwing helpers', () => {
  it('return the value for valid input and throw for invalid input', () => {
    expect(asLocalDate('2026-10-15')).toBe('2026-10-15');
    expect(asLocalTime('08:00')).toBe('08:00');
    expect(asTimestamp('2026-10-15T08:00:00Z')).toBe('2026-10-15T08:00:00.000Z');
    expect(() => asLocalDate('2026-02-30')).toThrow(RangeError);
    expect(() => asLocalTime('24:00')).toThrow(RangeError);
    expect(() => asTimestamp('nope')).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays(asLocalDate('2026-10-31'), 1)).toBe('2026-11-01');
    expect(addDays(asLocalDate('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(asLocalDate('2027-01-01'), -1)).toBe('2026-12-31');
  });

  it('handles February in leap and non-leap years', () => {
    expect(addDays(asLocalDate('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(asLocalDate('2024-02-28'), 2)).toBe('2024-03-01');
    expect(addDays(asLocalDate('2026-02-28'), 1)).toBe('2026-03-01');
  });

  it('adds nothing for zero and spans long ranges correctly', () => {
    expect(addDays(asLocalDate('2026-10-15'), 0)).toBe('2026-10-15');
    expect(addDays(asLocalDate('2026-01-01'), 365)).toBe('2027-01-01');
    expect(addDays(asLocalDate('2024-01-01'), 366)).toBe('2025-01-01');
  });

  it('rejects fractional days and results outside the supported range', () => {
    expect(() => addDays(asLocalDate('2026-10-15'), 0.5)).toThrow(RangeError);
    expect(() => addDays(asLocalDate('2999-12-31'), 1)).toThrow(RangeError);
  });
});

describe('comparisons', () => {
  it('orders dates, times and instants chronologically', () => {
    expect(compareLocalDates(asLocalDate('2026-10-14'), asLocalDate('2026-10-15'))).toBeLessThan(0);
    expect(compareLocalDates(asLocalDate('2026-10-15'), asLocalDate('2026-10-15'))).toBe(0);
    expect(compareLocalDates(asLocalDate('2027-01-01'), asLocalDate('2026-12-31'))).toBeGreaterThan(
      0,
    );
    expect(compareLocalTimes(asLocalTime('08:00'), asLocalTime('20:00'))).toBeLessThan(0);
    expect(compareLocalTimes(asLocalTime('09:30'), asLocalTime('09:05'))).toBeGreaterThan(0);
  });

  it('compares timestamps by the instant, whatever offset they were written with', () => {
    const a = asTimestamp('2026-10-15T10:00:00+02:00');
    const b = asTimestamp('2026-10-15T08:00:00Z');
    expect(compareTimestamps(a, b)).toBe(0);
    expect(compareTimestamps(a, asTimestamp('2026-10-15T08:00:01Z'))).toBeLessThan(0);
  });
});
