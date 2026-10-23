import type { LocalTime } from '@/types/primitives';
import { parseLocalTime } from './date';

// Reading a time of day that a person TYPED (PROJECT_SPEC DEC-49). The stored form never changes:
// a valid entry becomes the strict `HH:mm` that `parseLocalTime` accepts. Nothing here guesses:
// text that does not have one of the accepted shapes is not turned into a time.
//
// Accepted shapes, with hours 0-23 and minutes 00-59:
//   7:30   07:30   7.30   7:30 with surrounding spaces      hour, a colon or a point, two-digit minutes
//   730    0730                                            digits only: the last two are the minutes
// Rejected on purpose: a lone hour ("18"), minutes with one digit ("7:5"), seconds ("07:30:00"),
// other separators, letters, and anything that is not a time ("24:00", "7:60").

export type TimeInputState =
  /** Nothing typed (or only spaces). */
  | { kind: 'empty' }
  /** A time. `time` is the normalised `HH:mm`. */
  | { kind: 'valid'; time: LocalTime }
  /** The start of a time that could still become valid by typing more ("7", "07:", "07:3"). */
  | { kind: 'incomplete' }
  /** Has the shape of a time, but no such time exists ("24:00", "7:60", "2575"). */
  | { kind: 'out-of-range' }
  /** Does not look like a time at all ("abc", "7-30", "07:30:00"). */
  | { kind: 'unrecognised' };

const SEPARATED = /^(\d{1,2})[:.](\d{2})$/;
const COMPACT = /^(\d{1,2})(\d{2})$/;
const START_OF_TIME = /^(?:\d{1,2}|\d{1,2}[:.]\d?)$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Says what a typed text is: a time, the start of one, or something that cannot become one. */
export function describeTimeInput(text: string): TimeInputState {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };

  const match = SEPARATED.exec(trimmed) ?? COMPACT.exec(trimmed);
  if (match !== null) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return { kind: 'out-of-range' };
    const time = parseLocalTime(`${pad(hours)}:${pad(minutes)}`);
    return time === null ? { kind: 'unrecognised' } : { kind: 'valid', time };
  }
  return START_OF_TIME.test(trimmed) ? { kind: 'incomplete' } : { kind: 'unrecognised' };
}

/** The normalised `HH:mm` for a typed text, or `null` if it is not a complete, existing time. */
export function parseTimeInput(text: string): LocalTime | null {
  const state = describeTimeInput(text);
  return state.kind === 'valid' ? state.time : null;
}
