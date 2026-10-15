import { describe, expect, it } from 'vitest';
import { asTimestamp } from '@/utils/date';
import { assertOk, makeAppointment } from '@/test/fixtures';
import { changeAppointmentStatus, classifyAppointment, splitAppointments } from './status';

const NOW = asTimestamp('2026-10-15T12:00:00Z');

describe('classifyAppointment', () => {
  it('treats a scheduled appointment in the future as upcoming', () => {
    const appointment = makeAppointment({ scheduledAt: asTimestamp('2026-10-15T12:00:01Z') });

    expect(classifyAppointment(appointment, NOW)).toBe('upcoming');
  });

  it('treats an appointment starting at exactly the reference time as still upcoming', () => {
    const appointment = makeAppointment({ scheduledAt: NOW });

    expect(classifyAppointment(appointment, NOW)).toBe('upcoming');
  });

  it('treats a scheduled appointment whose time has passed as needing confirmation, not as completed', () => {
    const appointment = makeAppointment({ scheduledAt: asTimestamp('2026-10-15T11:59:59Z') });

    expect(classifyAppointment(appointment, NOW)).toBe('needs-confirmation');
    expect(appointment.status).toBe('scheduled');
  });

  it('puts completed and cancelled appointments in the past, whatever their time', () => {
    const future = asTimestamp('2026-12-01T10:00:00Z');
    const earlier = asTimestamp('2026-01-01T10:00:00Z');

    expect(
      classifyAppointment(makeAppointment({ status: 'completed', scheduledAt: earlier }), NOW),
    ).toBe('past');
    expect(
      classifyAppointment(makeAppointment({ status: 'cancelled', scheduledAt: earlier }), NOW),
    ).toBe('past');
    expect(
      classifyAppointment(makeAppointment({ status: 'cancelled', scheduledAt: future }), NOW),
    ).toBe('past');
  });

  it('compares instants, so the same moment written with another offset gives the same answer', () => {
    const appointment = makeAppointment({ scheduledAt: asTimestamp('2026-10-15T14:00:00+02:00') });

    expect(classifyAppointment(appointment, NOW)).toBe('upcoming');
  });
});

describe('splitAppointments', () => {
  const soon = makeAppointment({ id: 'soon', scheduledAt: asTimestamp('2026-10-16T08:00:00Z') });
  const later = makeAppointment({ id: 'later', scheduledAt: asTimestamp('2026-11-01T08:00:00Z') });
  const unconfirmed = makeAppointment({
    id: 'unconfirmed',
    scheduledAt: asTimestamp('2026-10-10T08:00:00Z'),
  });
  const done = makeAppointment({
    id: 'done',
    status: 'completed',
    scheduledAt: asTimestamp('2026-09-01T08:00:00Z'),
  });
  const cancelledAhead = makeAppointment({
    id: 'cancelled',
    status: 'cancelled',
    scheduledAt: asTimestamp('2026-10-30T08:00:00Z'),
  });

  it('lists upcoming soonest first and past most recent first, with unconfirmed ones among the past', () => {
    const { upcoming, past } = splitAppointments(
      [later, done, unconfirmed, cancelledAhead, soon],
      NOW,
    );

    expect(upcoming.map((a) => a.id)).toEqual(['soon', 'later']);
    expect(past.map((a) => a.id)).toEqual(['cancelled', 'unconfirmed', 'done']);
  });

  it('gives the same result whatever the input order, using the id to break ties', () => {
    const twinA = makeAppointment({ id: 'a', scheduledAt: asTimestamp('2026-10-20T08:00:00Z') });
    const twinB = makeAppointment({ id: 'b', scheduledAt: asTimestamp('2026-10-20T08:00:00Z') });

    expect(splitAppointments([twinB, twinA], NOW)).toEqual(splitAppointments([twinA, twinB], NOW));
    expect(splitAppointments([twinB, twinA], NOW).upcoming.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('does not modify its input', () => {
    const input = [later, soon];

    splitAppointments(input, NOW);

    expect(input.map((a) => a.id)).toEqual(['later', 'soon']);
  });

  it('returns empty lists for no appointments', () => {
    expect(splitAppointments([], NOW)).toEqual({ upcoming: [], past: [] });
  });
});

describe('changeAppointmentStatus', () => {
  const later = asTimestamp('2026-10-15T13:00:00Z');

  it.each(['completed', 'cancelled'] as const)(
    'lets a scheduled appointment become %s',
    (status) => {
      const appointment = makeAppointment();

      const result = changeAppointmentStatus(appointment, status, later);

      assertOk(result);
      expect(result.changed).toBe(true);
      expect(result.appointment).toEqual({ ...appointment, status, updatedAt: later });
    },
  );

  it('leaves the date, time and other details untouched', () => {
    const appointment = makeAppointment({ location: 'Gabinet 4', notes: 'Wyniki' });

    const result = changeAppointmentStatus(appointment, 'completed', later);

    assertOk(result);
    expect(result.appointment.scheduledAt).toBe(appointment.scheduledAt);
    expect(result.appointment.location).toBe('Gabinet 4');
    expect(result.appointment.notes).toBe('Wyniki');
  });

  it.each(['completed', 'cancelled'] as const)(
    'lets a %s appointment be put back to scheduled to correct a mistake',
    (status) => {
      const result = changeAppointmentStatus(makeAppointment({ status }), 'scheduled', later);

      assertOk(result);
      expect(result.appointment.status).toBe('scheduled');
      expect(result.changed).toBe(true);
    },
  );

  it('refuses to go straight from completed to cancelled, or back', () => {
    expect(
      changeAppointmentStatus(makeAppointment({ status: 'completed' }), 'cancelled', later),
    ).toEqual({
      ok: false,
      error: 'invalid-transition',
    });
    expect(
      changeAppointmentStatus(makeAppointment({ status: 'cancelled' }), 'completed', later),
    ).toEqual({
      ok: false,
      error: 'invalid-transition',
    });
  });

  it('succeeds without change when the status is already the requested one (repeat-safe)', () => {
    const appointment = makeAppointment({ status: 'completed' });

    const result = changeAppointmentStatus(appointment, 'completed', later);

    assertOk(result);
    expect(result.changed).toBe(false);
    expect(result.appointment).toBe(appointment);
  });

  it('does not modify the original appointment', () => {
    const appointment = makeAppointment();

    changeAppointmentStatus(appointment, 'cancelled', later);

    expect(appointment.status).toBe('scheduled');
  });

  it('lets an appointment that has not happened yet be marked completed (not blocked)', () => {
    const future = makeAppointment({ scheduledAt: asTimestamp('2026-12-01T10:00:00Z') });

    expect(changeAppointmentStatus(future, 'completed', later).ok).toBe(true);
  });
});
