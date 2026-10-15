/** Unique identifier of a stored entity (a UUID string). */
export type Id = string;

// Branded strings: at runtime they are plain strings, but the compiler refuses to accept an
// arbitrary string where a validated value is required. Values are created only by the
// parse functions in `@/utils/date`, which check the format strictly.

/** A calendar date without a time zone, formatted `YYYY-MM-DD`. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

/** A wall-clock time of day without a date or time zone, formatted `HH:mm` (00:00-23:59). */
export type LocalTime = string & { readonly __brand: 'LocalTime' };

/** A real moment in time, always normalised to UTC, e.g. `2026-10-15T08:30:00.000Z`. */
export type Timestamp = string & { readonly __brand: 'Timestamp' };
