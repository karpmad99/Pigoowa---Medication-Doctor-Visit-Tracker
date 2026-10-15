import { describe, expect, it } from 'vitest';
import { asLocalDate, asLocalTime, asTimestamp } from './date';
import { getLocalDateInZone, isValidTimeZone, localDateTimeToTimestamp } from './timeZone';

const WARSAW = 'Europe/Warsaw';

describe('isValidTimeZone', () => {
  it('recognises IANA names and rejects unknown ones', () => {
    expect(isValidTimeZone('Europe/Warsaw')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('getLocalDateInZone ("today" depends on the zone)', () => {
  it('is already tomorrow in Warsaw late in the evening UTC (winter, UTC+1)', () => {
    const instant = asTimestamp('2026-01-15T23:30:00Z');
    expect(getLocalDateInZone(instant, 'UTC')).toBe('2026-01-15');
    expect(getLocalDateInZone(instant, WARSAW)).toBe('2026-01-16');
  });

  it('uses UTC+2 in summer', () => {
    expect(getLocalDateInZone(asTimestamp('2026-07-15T21:59:59Z'), WARSAW)).toBe('2026-07-15');
    expect(getLocalDateInZone(asTimestamp('2026-07-15T22:00:00Z'), WARSAW)).toBe('2026-07-16');
  });

  it('flips exactly at local midnight', () => {
    // 2026-01-15T23:00:00Z is 00:00 on 16 January in Warsaw.
    expect(getLocalDateInZone(asTimestamp('2026-01-15T22:59:59Z'), WARSAW)).toBe('2026-01-15');
    expect(getLocalDateInZone(asTimestamp('2026-01-15T23:00:00Z'), WARSAW)).toBe('2026-01-16');
  });

  it('handles a zone behind UTC', () => {
    expect(getLocalDateInZone(asTimestamp('2026-01-15T03:00:00Z'), 'America/New_York')).toBe(
      '2026-01-14',
    );
  });

  it('throws for an unknown time zone instead of guessing', () => {
    expect(() => getLocalDateInZone(asTimestamp('2026-01-15T03:00:00Z'), 'Nowhere/Land')).toThrow(
      RangeError,
    );
  });
});

describe('localDateTimeToTimestamp', () => {
  const convert = (date: string, time: string, zone = WARSAW) =>
    localDateTimeToTimestamp(asLocalDate(date), asLocalTime(time), zone);

  it('converts an ordinary winter time (UTC+1)', () => {
    expect(convert('2026-01-15', '08:00')).toEqual({
      ok: true,
      timestamp: '2026-01-15T07:00:00.000Z',
      ambiguous: false,
    });
  });

  it('converts an ordinary summer time (UTC+2)', () => {
    expect(convert('2026-07-15', '08:00')).toEqual({
      ok: true,
      timestamp: '2026-07-15T06:00:00.000Z',
      ambiguous: false,
    });
  });

  it('converts midnight and the last minute of the day', () => {
    expect(convert('2026-01-16', '00:00')).toMatchObject({ timestamp: '2026-01-15T23:00:00.000Z' });
    expect(convert('2026-01-15', '23:59')).toMatchObject({ timestamp: '2026-01-15T22:59:00.000Z' });
  });

  describe('spring forward: Europe/Warsaw on 2026-03-29, 02:00 jumps to 03:00', () => {
    it('rejects a time that does not exist', () => {
      expect(convert('2026-03-29', '02:30')).toEqual({
        ok: false,
        error: 'nonexistent-local-time',
      });
      expect(convert('2026-03-29', '02:00')).toEqual({
        ok: false,
        error: 'nonexistent-local-time',
      });
    });

    it('accepts the minute before and the minute after the gap', () => {
      expect(convert('2026-03-29', '01:59')).toMatchObject({
        ok: true,
        timestamp: '2026-03-29T00:59:00.000Z',
      });
      expect(convert('2026-03-29', '03:00')).toMatchObject({
        ok: true,
        timestamp: '2026-03-29T01:00:00.000Z',
      });
    });
  });

  describe('fall back: Europe/Warsaw on 2026-10-25, 03:00 returns to 02:00', () => {
    it('resolves a repeated time to its earlier occurrence and flags it as ambiguous', () => {
      // 02:30 happens at 00:30Z (UTC+2) and again at 01:30Z (UTC+1); the earlier one wins.
      expect(convert('2026-10-25', '02:30')).toEqual({
        ok: true,
        timestamp: '2026-10-25T00:30:00.000Z',
        ambiguous: true,
      });
    });

    it('treats times outside the repeated hour as unambiguous', () => {
      expect(convert('2026-10-25', '01:59')).toMatchObject({ ambiguous: false });
      expect(convert('2026-10-25', '03:00')).toEqual({
        ok: true,
        timestamp: '2026-10-25T02:00:00.000Z',
        ambiguous: false,
      });
    });
  });

  it('round-trips with getLocalDateInZone', () => {
    const result = convert('2026-06-30', '23:45');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getLocalDateInZone(result.timestamp, WARSAW)).toBe('2026-06-30');
    }
  });
});
