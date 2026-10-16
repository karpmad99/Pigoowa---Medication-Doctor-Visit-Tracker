import type { LocalDate, Timestamp } from '@/types/primitives';
import { timestampToMs } from './date';

// Polish formatting for display. Storage and logic always use the plain formats of
// `./date` (YYYY-MM-DD, HH:mm, ISO instants); only the UI turns them into text like this.

const LOCALE = 'pl-PL';

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  // A LocalDate has no time zone. Formatting it in UTC guarantees the shown day is the stored day.
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const quantityFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 });

/** `2026-10-15` -> `czwartek, 15 października 2026`. */
export function formatLocalDate(date: LocalDate): string {
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return dateFormatter.format(new Date(ms));
}

const dayFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** `2026-10-15` -> `15 października 2026` (no weekday), for compact lists. */
export function formatLocalDay(date: LocalDate): string {
  const ms = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  return dayFormatter.format(new Date(ms));
}

const pluralRules = new Intl.PluralRules(LOCALE);

/**
 * Picks the Polish noun form for a count: 1 zapis, 2-4 zapisy, 5+ (and 0, 12-14, ...) zapisów.
 * Fractions use the "many" form, as Polish does.
 */
export function pluralize(
  count: number,
  forms: { one: string; few: string; many: string },
): string {
  const category = pluralRules.select(count);
  return category === 'one' ? forms.one : category === 'few' ? forms.few : forms.many;
}

/** An instant as the wall clock in `timeZone` shows it: `15 października 2026 12:30`. */
export function formatTimestamp(instant: Timestamp, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestampToMs(instant)));
}

/** `1.5` -> `1,5` (Polish decimal comma), at most three decimals, no trailing zeros. */
export function formatQuantity(value: number): string {
  return quantityFormatter.format(value);
}
