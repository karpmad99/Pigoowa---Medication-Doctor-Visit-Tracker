import { describe, expect, it } from 'vitest';
import { createFixedClock, getUserTimeZone, systemClock } from './clock';
import { parseTimestamp } from './date';
import { isValidTimeZone } from './timeZone';

describe('clocks', () => {
  it('a fixed clock always reports the same instant, normalised to UTC', () => {
    const clock = createFixedClock('2026-10-15T12:00:00+02:00');

    expect(clock.now()).toBe('2026-10-15T10:00:00.000Z');
    expect(clock.now()).toBe(clock.now());
  });

  it('refuses an invalid fixed instant instead of silently using some other time', () => {
    expect(() => createFixedClock('yesterday')).toThrow(RangeError);
  });

  it('the system clock produces valid, non-decreasing timestamps', () => {
    const first = systemClock.now();
    const second = systemClock.now();

    expect(parseTimestamp(first)).toBe(first);
    expect(second >= first).toBe(true);
  });

  it('reports a usable time zone for the browser', () => {
    expect(isValidTimeZone(getUserTimeZone())).toBe(true);
  });
});
