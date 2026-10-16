import type { LocalDate, LocalTime, Timestamp } from '@/types/primitives';

// Calendar dates and times of day are handled here as plain strings with strict validation.
// Moments in time (`Timestamp`) are kept separate; converting between the two requires a
// time zone and lives in `./timeZone`.

/** Supported calendar range. Keeps `Date.UTC` free of its two-digit-year quirk. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2999;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/** Returns the date if `input` is a real calendar date in `YYYY-MM-DD` form, otherwise `null`. */
export function parseLocalDate(input: string): LocalDate | null {
  if (!LOCAL_DATE_PATTERN.test(input)) return null;
  const year = Number(input.slice(0, 4));
  const month = Number(input.slice(5, 7));
  const day = Number(input.slice(8, 10));
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return input as LocalDate;
}

/** Returns the time if `input` is a valid `HH:mm` (24-hour) time, otherwise `null`. "24:00" is invalid. */
export function parseLocalTime(input: string): LocalTime | null {
  return LOCAL_TIME_PATTERN.test(input) ? (input as LocalTime) : null;
}

/**
 * Returns the instant if `input` is an ISO 8601 date-time with an explicit `Z` or numeric
 * offset (e.g. what Postgres returns for `timestamptz`), normalised to UTC. Otherwise `null`.
 * Strings without an offset are rejected on purpose: they would be ambiguous.
 */
export function parseTimestamp(input: string): Timestamp | null {
  if (!TIMESTAMP_PATTERN.test(input)) return null;
  if (parseLocalDate(input.slice(0, 10)) === null) return null;
  const ms = Date.parse(input);
  return Number.isNaN(ms) ? null : timestampFromMs(ms);
}

// The `as*` variants throw instead of returning `null`. They are meant for constants and
// tests, where an invalid literal is a programming error.

export function asLocalDate(input: string): LocalDate {
  const value = parseLocalDate(input);
  if (value === null) throw new RangeError(`Invalid LocalDate: ${input}`);
  return value;
}

export function asLocalTime(input: string): LocalTime {
  const value = parseLocalTime(input);
  if (value === null) throw new RangeError(`Invalid LocalTime: ${input}`);
  return value;
}

export function asTimestamp(input: string): Timestamp {
  const value = parseTimestamp(input);
  if (value === null) throw new RangeError(`Invalid Timestamp: ${input}`);
  return value;
}

/** The first and last supported day, for "all dates" queries. */
export const EARLIEST_LOCAL_DATE = asLocalDate(`${String(MIN_YEAR)}-01-01`);
export const LATEST_LOCAL_DATE = asLocalDate(`${String(MAX_YEAR)}-12-31`);

/** Adds (or, if negative, subtracts) whole calendar days. Leap years and month ends are handled. */
export function addDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) throw new RangeError(`Days must be an integer, got ${String(days)}`);
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)) + days,
  );
  const result = parseLocalDate(new Date(ms).toISOString().slice(0, 10));
  if (result === null)
    throw new RangeError(`Date out of supported range after adding ${String(days)} days`);
  return result;
}

/** Negative if `a` is earlier than `b`, positive if later, 0 if equal. */
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative if `a` is earlier in the day than `b`, positive if later, 0 if equal. */
export function compareLocalTimes(a: LocalTime, b: LocalTime): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function timestampFromMs(ms: number): Timestamp {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid time value: ${String(ms)}`);
  return date.toISOString() as Timestamp;
}

export function timestampToMs(timestamp: Timestamp): number {
  return Date.parse(timestamp);
}

/** Negative if `a` is earlier than `b`, positive if later, 0 if the same instant. */
export function compareTimestamps(a: Timestamp, b: Timestamp): number {
  return timestampToMs(a) - timestampToMs(b);
}
