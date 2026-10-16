import { describe, expect, it } from 'vitest';
import { makeAppointment } from '@/test/fixtures';
import { asTimestamp } from '@/utils/date';
import { selectDashboardAppointments } from './dashboard';

const NOW = asTimestamp('2026-10-15T10:00:00Z');
const at = (id: string, instant: string, overrides = {}) =>
  makeAppointment({ id, scheduledAt: asTimestamp(instant), ...overrides });

describe('selectDashboardAppointments', () => {
  it('returns the next upcoming appointments, soonest first, at most three', () => {
    const result = selectDashboardAppointments(
      [
        at('e', '2026-12-01T08:00:00Z'),
        at('b', '2026-10-17T08:00:00Z'),
        at('d', '2026-11-01T08:00:00Z'),
        at('a', '2026-10-16T08:00:00Z'),
        at('c', '2026-10-20T08:00:00Z'),
      ],
      NOW,
    );

    expect(result.upcoming.map((appointment) => appointment.id)).toEqual(['a', 'b', 'c']);
    expect(result.upcomingTotal).toBe(5);
  });

  it('honours another limit', () => {
    const result = selectDashboardAppointments(
      [at('a', '2026-10-16T08:00:00Z'), at('b', '2026-10-17T08:00:00Z')],
      NOW,
      1,
    );
    expect(result.upcoming.map((appointment) => appointment.id)).toEqual(['a']);
    expect(result.upcomingTotal).toBe(2);
  });

  it('counts an appointment at exactly the current instant as upcoming, and one second earlier as needing confirmation', () => {
    const result = selectDashboardAppointments(
      [at('now', '2026-10-15T10:00:00Z'), at('earlier', '2026-10-15T09:59:59Z')],
      NOW,
    );

    expect(result.upcoming.map((appointment) => appointment.id)).toEqual(['now']);
    expect(result.needsConfirmation).toBe(1);
  });

  it('counts elapsed scheduled appointments only, not completed or cancelled ones, and does not list them as upcoming', () => {
    const result = selectDashboardAppointments(
      [
        at('elapsed-1', '2026-10-14T08:00:00Z'),
        at('elapsed-2', '2026-10-01T08:00:00Z'),
        at('done', '2026-10-02T08:00:00Z', { status: 'completed' }),
        at('off', '2026-10-03T08:00:00Z', { status: 'cancelled' }),
      ],
      NOW,
    );

    expect(result).toEqual({ upcoming: [], upcomingTotal: 0, needsConfirmation: 2 });
  });

  it('leaves a cancelled or completed appointment out of the upcoming list even when its time has not come', () => {
    const result = selectDashboardAppointments(
      [
        at('off', '2026-10-20T08:00:00Z', { status: 'cancelled' }),
        at('done', '2026-10-21T08:00:00Z', { status: 'completed' }),
        at('ok', '2026-10-22T08:00:00Z'),
      ],
      NOW,
    );

    expect(result.upcoming.map((appointment) => appointment.id)).toEqual(['ok']);
    expect(result.needsConfirmation).toBe(0);
  });

  it('is empty for no appointments, and does not modify its input', () => {
    expect(selectDashboardAppointments([], NOW)).toEqual({
      upcoming: [],
      upcomingTotal: 0,
      needsConfirmation: 0,
    });
    const input = [at('b', '2026-10-17T08:00:00Z'), at('a', '2026-10-16T08:00:00Z')];
    const snapshot = structuredClone(input);
    selectDashboardAppointments(input, NOW);
    expect(input).toEqual(snapshot);
  });
});
