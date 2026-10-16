import { describe, expect, it } from 'vitest';
import { makeAppointment } from '@/test/fixtures';
import { asTimestamp } from '@/utils/date';
import { groupAppointmentsByDate } from './grouping';

const WARSAW = 'Europe/Warsaw';
const at = (id: string, instant: string) =>
  makeAppointment({ id, scheduledAt: asTimestamp(instant) });

describe('groupAppointmentsByDate', () => {
  it('groups consecutive appointments of the same local day and keeps the given order', () => {
    const days = groupAppointmentsByDate(
      [
        at('a', '2026-10-20T08:00:00Z'),
        at('b', '2026-10-20T13:00:00Z'),
        at('c', '2026-10-22T08:00:00Z'),
      ],
      WARSAW,
    );

    expect(days.map((day) => [day.date, day.appointments.map((entry) => entry.id)])).toEqual([
      ['2026-10-20', ['a', 'b']],
      ['2026-10-22', ['c']],
    ]);
  });

  it('uses the date on the wall clock in the zone, not the UTC date, around midnight', () => {
    // Summer time (UTC+2): 21:59Z is 23:59 on the 15th, 22:00Z is 00:00 on the 16th.
    const days = groupAppointmentsByDate(
      [at('late', '2026-10-15T21:59:00Z'), at('midnight', '2026-10-15T22:00:00Z')],
      WARSAW,
    );

    expect(days.map((day) => [day.date, day.appointments.map((entry) => entry.id)])).toEqual([
      ['2026-10-15', ['late']],
      ['2026-10-16', ['midnight']],
    ]);
  });

  it('puts two instants with the same UTC date on different days when the zone says so', () => {
    const days = groupAppointmentsByDate(
      [at('a', '2026-01-15T00:30:00Z'), at('b', '2026-01-15T23:30:00Z')],
      WARSAW, // winter, UTC+1: 01:30 on the 15th and 00:30 on the 16th
    );

    expect(days.map((day) => day.date)).toEqual(['2026-01-15', '2026-01-16']);
  });

  it('keeps a descending list descending (the past list)', () => {
    const days = groupAppointmentsByDate(
      [
        at('c', '2026-10-22T08:00:00Z'),
        at('b', '2026-10-20T13:00:00Z'),
        at('a', '2026-10-20T08:00:00Z'),
      ],
      WARSAW,
    );

    expect(days.map((day) => day.date)).toEqual(['2026-10-22', '2026-10-20']);
    expect(days[1]?.appointments.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('gives no days for no appointments, and does not modify its input', () => {
    expect(groupAppointmentsByDate([], WARSAW)).toEqual([]);
    const input = [at('a', '2026-10-20T08:00:00Z')];
    const snapshot = structuredClone(input);
    groupAppointmentsByDate(input, WARSAW);
    expect(input).toEqual(snapshot);
  });
});
