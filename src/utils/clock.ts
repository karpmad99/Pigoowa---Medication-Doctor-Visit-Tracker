import type { Timestamp } from '@/types/primitives';
import { asTimestamp, timestampFromMs } from './date';
import { isValidTimeZone } from './timeZone';

/**
 * The only place the application asks "what time is it?". Business functions never do: they
 * receive `now` as an argument, and the code that calls them gets it from a Clock. Tests (and
 * the demo data) supply a fixed one, so nothing depends on the real current time.
 */
export interface Clock {
  now(): Timestamp;
}

/** The real current time. */
export const systemClock: Clock = {
  now: () => timestampFromMs(Date.now()),
};

/** A clock that always reports the same instant. */
export function createFixedClock(instant: string): Clock {
  const fixed = asTimestamp(instant);
  return { now: () => fixed };
}

const FALLBACK_TIME_ZONE = 'Europe/Warsaw';

/**
 * The time zone of this browser (PROJECT_SPEC DEC-10). Falls back to Warsaw if the browser
 * reports none or an unusable one. Later this becomes a setting stored in the user's profile.
 */
export function getUserTimeZone(): string {
  const reported = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(reported) ? reported : FALLBACK_TIME_ZONE;
}
