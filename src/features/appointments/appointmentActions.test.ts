import { describe, expect, it } from 'vitest';
import { RepositoryError } from '@/services/errors';
import { makeAppointment } from '@/test/fixtures';
import { createTestServices, TEST_TIME_ZONE } from '@/test/services';
import { asTimestamp } from '@/utils/date';
import { applyAppointmentStatusChange, saveAppointmentEdit } from './appointmentActions';
import { appointmentToFormValues } from './logic/appointmentForm';

const NOW = asTimestamp('2026-10-15T10:00:00Z');

async function setup(overrides: Parameters<typeof makeAppointment>[0] = {}) {
  const services = createTestServices();
  const appointment = makeAppointment({ id: 'a-1', ...overrides });
  await services.repositories.appointments.create(appointment);
  return { services, appointment };
}

describe('applyAppointmentStatusChange', () => {
  it('marks a scheduled appointment completed or cancelled, and restores it, writing that one record', async () => {
    const { services } = await setup();
    const { repositories } = services;

    const completed = await applyAppointmentStatusChange({
      repositories,
      id: 'a-1',
      status: 'completed',
      now: NOW,
    });
    expect(completed).toMatchObject({ ok: true, change: 'changed' });
    expect((await repositories.appointments.get('a-1')).status).toBe('completed');

    const restored = await applyAppointmentStatusChange({
      repositories,
      id: 'a-1',
      status: 'scheduled',
      now: NOW,
    });
    expect(restored).toMatchObject({ ok: true, change: 'changed' });
    expect((await repositories.appointments.get('a-1')).status).toBe('scheduled');

    await applyAppointmentStatusChange({ repositories, id: 'a-1', status: 'cancelled', now: NOW });
    expect((await repositories.appointments.get('a-1')).status).toBe('cancelled');
  });

  it('leaves date, time and details untouched and touches no other appointment', async () => {
    const { services, appointment } = await setup();
    await services.repositories.appointments.create(makeAppointment({ id: 'a-2' }));

    await applyAppointmentStatusChange({
      repositories: services.repositories,
      id: 'a-1',
      status: 'completed',
      now: NOW,
    });

    expect(await services.repositories.appointments.get('a-1')).toEqual({
      ...appointment,
      status: 'completed',
      updatedAt: NOW,
    });
    expect(await services.repositories.appointments.get('a-2')).toEqual(
      makeAppointment({ id: 'a-2' }),
    );
  });

  it('refuses to go straight from completed to cancelled, and writes nothing', async () => {
    const { services } = await setup({ status: 'completed' });
    const writesBefore = services.storage.writes.length;

    const outcome = await applyAppointmentStatusChange({
      repositories: services.repositories,
      id: 'a-1',
      status: 'cancelled',
      now: NOW,
    });

    expect(outcome).toEqual({ ok: false, error: 'invalid-transition' });
    expect(services.storage.writes).toHaveLength(writesBefore);
    expect((await services.repositories.appointments.get('a-1')).status).toBe('completed');
  });

  it('works on the STORED status, not on what a screen believed: a repeat is a harmless no-op', async () => {
    const { services } = await setup({ status: 'completed' }); // the screen still shows "scheduled"
    const writesBefore = services.storage.writes.length;

    const outcome = await applyAppointmentStatusChange({
      repositories: services.repositories,
      id: 'a-1',
      status: 'completed',
      now: NOW,
    });

    expect(outcome).toMatchObject({ ok: true, change: 'unchanged' });
    expect(services.storage.writes).toHaveLength(writesBefore);
  });

  it('rejects with not-found for an appointment that no longer exists, and creates nothing', async () => {
    const { services } = await setup();
    await services.repositories.appointments.remove('a-1');

    await expect(
      applyAppointmentStatusChange({
        repositories: services.repositories,
        id: 'a-1',
        status: 'completed',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(await services.repositories.appointments.list()).toEqual([]);
  });

  it('rejects when storage refuses the write, and the status stays', async () => {
    const { services } = await setup();
    services.storage.failWrites();

    await expect(
      applyAppointmentStatusChange({
        repositories: services.repositories,
        id: 'a-1',
        status: 'completed',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RepositoryError);

    services.storage.heal();
    expect((await services.repositories.appointments.get('a-1')).status).toBe('scheduled');
  });
});

describe('saveAppointmentEdit', () => {
  it('saves the edit onto the STORED appointment, so a status changed meanwhile is not undone', async () => {
    const { services, appointment } = await setup();
    const values = appointmentToFormValues(appointment, TEST_TIME_ZONE); // form opened while "scheduled"
    await applyAppointmentStatusChange({
      repositories: services.repositories,
      id: 'a-1',
      status: 'cancelled',
      now: asTimestamp('2026-10-15T09:00:00Z'),
    });

    const outcome = await saveAppointmentEdit({
      repositories: services.repositories,
      id: 'a-1',
      values: { ...values, location: 'Nowe miejsce' },
      now: NOW,
      timeZone: TEST_TIME_ZONE,
    });

    expect(outcome).toMatchObject({ ok: true, changed: true });
    expect(await services.repositories.appointments.get('a-1')).toMatchObject({
      id: 'a-1',
      status: 'cancelled',
      location: 'Nowe miejsce',
      updatedAt: NOW,
    });
  });

  it('writes nothing when nothing changed', async () => {
    const { services, appointment } = await setup();
    const writesBefore = services.storage.writes.length;

    const outcome = await saveAppointmentEdit({
      repositories: services.repositories,
      id: 'a-1',
      values: appointmentToFormValues(appointment, TEST_TIME_ZONE),
      now: NOW,
      timeZone: TEST_TIME_ZONE,
    });

    expect(outcome).toMatchObject({ ok: true, changed: false });
    expect(services.storage.writes).toHaveLength(writesBefore);
  });

  it('returns the validation problems and writes nothing for an invalid form', async () => {
    const { services, appointment } = await setup();
    const writesBefore = services.storage.writes.length;

    const outcome = await saveAppointmentEdit({
      repositories: services.repositories,
      id: 'a-1',
      values: {
        ...appointmentToFormValues(appointment, TEST_TIME_ZONE),
        doctorName: '',
        specialty: '',
      },
      now: NOW,
      timeZone: TEST_TIME_ZONE,
    });

    expect(outcome.ok).toBe(false);
    expect(services.storage.writes).toHaveLength(writesBefore);
  });

  it('rejects with not-found when the appointment was deleted meanwhile, and does not recreate it', async () => {
    const { services, appointment } = await setup();
    const values = appointmentToFormValues(appointment, TEST_TIME_ZONE);
    await services.repositories.appointments.remove('a-1');

    await expect(
      saveAppointmentEdit({
        repositories: services.repositories,
        id: 'a-1',
        values: { ...values, notes: 'x' },
        now: NOW,
        timeZone: TEST_TIME_ZONE,
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(await services.repositories.appointments.list()).toEqual([]);
  });

  it('rejects when storage refuses the write, and the stored appointment stays as it was', async () => {
    const { services, appointment } = await setup();
    const values = appointmentToFormValues(appointment, TEST_TIME_ZONE);
    services.storage.failWrites();

    await expect(
      saveAppointmentEdit({
        repositories: services.repositories,
        id: 'a-1',
        values: { ...values, notes: 'x' },
        now: NOW,
        timeZone: TEST_TIME_ZONE,
      }),
    ).rejects.toBeInstanceOf(RepositoryError);

    services.storage.heal();
    expect(await services.repositories.appointments.get('a-1')).toEqual(appointment);
  });
});
