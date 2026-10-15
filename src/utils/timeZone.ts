import type { LocalDate, LocalTime, Timestamp } from '@/types/primitives';
import { asLocalDate, timestampFromMs, timestampToMs } from './date';

// Everything that needs a time zone lives here, built on the standard `Intl` API (no date
// library). Time zones are IANA names such as "Europe/Warsaw".

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    // Throws RangeError for an unknown time zone.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** What a wall clock in `timeZone` shows at the instant `ms`. */
function getWallClock(ms: number, timeZone: string): WallClock {
  const parts = getFormatter(timeZone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`Intl did not return a "${type}" part`);
    return Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function wallClockAsUtcMs(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** Offset of `timeZone` from UTC at the instant `ms` (positive = ahead of UTC). */
function getOffsetMs(ms: number, timeZone: string): number {
  const wholeSeconds = Math.floor(ms / 1000) * 1000;
  return wallClockAsUtcMs(getWallClock(wholeSeconds, timeZone)) - wholeSeconds;
}

/** The calendar date on the wall clock in `timeZone` at a given instant. This is how "today" is defined. */
export function getLocalDateInZone(instant: Timestamp, timeZone: string): LocalDate {
  const wall = getWallClock(timestampToMs(instant), timeZone);
  const month = String(wall.month).padStart(2, '0');
  const day = String(wall.day).padStart(2, '0');
  return asLocalDate(`${String(wall.year).padStart(4, '0')}-${month}-${day}`);
}

export type LocalDateTimeConversion =
  | {
      ok: true;
      timestamp: Timestamp;
      /** True when the wall-clock time happens twice (clocks go back); the earlier one was chosen. */
      ambiguous: boolean;
    }
  | {
      ok: false;
      /** The wall-clock time was skipped by a clock change (clocks go forward). */
      error: 'nonexistent-local-time';
    };

/**
 * Converts "this date and this wall-clock time in this zone" into the real instant.
 *
 * Daylight-saving rules (documented behaviour, not silent normalisation):
 * - a time that does not exist (e.g. 02:30 on the night clocks go forward) is rejected;
 * - a time that happens twice (e.g. 02:30 when clocks go back) resolves to the earlier occurrence.
 */
export function localDateTimeToTimestamp(
  date: LocalDate,
  time: LocalTime,
  timeZone: string,
): LocalDateTimeConversion {
  const wantedAsUtc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5)),
  );

  // The offset in force a day before and a day after bracket any clock change near the
  // wanted time. A candidate instant is valid only if its own wall clock matches the request.
  const candidateOffsets = new Set([
    getOffsetMs(wantedAsUtc - MS_PER_DAY, timeZone),
    getOffsetMs(wantedAsUtc + MS_PER_DAY, timeZone),
  ]);
  const matches: number[] = [];
  for (const offset of candidateOffsets) {
    const candidate = wantedAsUtc - offset;
    if (getOffsetMs(candidate, timeZone) === offset) matches.push(candidate);
  }

  if (matches.length === 0) return { ok: false, error: 'nonexistent-local-time' };
  return {
    ok: true,
    timestamp: timestampFromMs(Math.min(...matches)),
    ambiguous: matches.length > 1,
  };
}
