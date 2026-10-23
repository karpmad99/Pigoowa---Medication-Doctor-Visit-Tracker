import { describe, expect, it } from 'vitest';
import { makeDoseLog, makeMedication } from '@/test/fixtures';
import { asLocalDate, asLocalTime } from '@/utils/date';
import { selectNextUnrecordedDose } from './nextDose';
import { generateScheduledDoses } from './scheduledDoses';

const date = asLocalDate('2026-10-15');

function dayOf(
  medications: Parameters<typeof generateScheduledDoses>[0]['medications'],
  doseLogs: Parameters<typeof generateScheduledDoses>[0]['doseLogs'] = [],
) {
  return generateScheduledDoses({ medications, doseLogs, date }).doses;
}

function recorded(
  id: string,
  time: string,
  status: 'taken' | 'skipped',
): ReturnType<typeof makeDoseLog> {
  return makeDoseLog({ id, medicationId: 'med-a', scheduledTime: asLocalTime(time), status });
}

const morningNoonEvening = makeMedication({
  id: 'med-a',
  name: 'Alfa',
  scheduleTimes: [
    { id: 't1', timeOfDay: asLocalTime('08:00'), doseAmount: 1 },
    { id: 't2', timeOfDay: asLocalTime('14:00'), doseAmount: 1 },
    { id: 't3', timeOfDay: asLocalTime('20:00'), doseAmount: 1 },
  ],
});

describe('selectNextUnrecordedDose', () => {
  it('is the first dose of the day when nothing is recorded', () => {
    const next = selectNextUnrecordedDose(dayOf([morningNoonEvening]));

    expect(next?.time).toBe('08:00');
  });

  it('moves on to the next dose without a record once one is recorded, taken or skipped', () => {
    const taken = recorded('a', '08:00', 'taken');
    const skipped = recorded('b', '14:00', 'skipped');

    expect(selectNextUnrecordedDose(dayOf([morningNoonEvening], [taken]))?.time).toBe('14:00');
    expect(selectNextUnrecordedDose(dayOf([morningNoonEvening], [taken, skipped]))?.time).toBe(
      '20:00',
    );
  });

  it('skips a recorded dose in the middle and still finds an earlier one without a record', () => {
    const middle = recorded('m', '14:00', 'taken');

    expect(selectNextUnrecordedDose(dayOf([morningNoonEvening], [middle]))?.time).toBe('08:00');
  });

  it('is null when every dose has a record', () => {
    const logs = ['08:00', '14:00', '20:00'].map((time, index) =>
      recorded(`log-${String(index)}`, time, index === 1 ? 'skipped' : 'taken'),
    );

    expect(selectNextUnrecordedDose(dayOf([morningNoonEvening], logs))).toBeNull();
  });

  it('is null for a day with no doses', () => {
    expect(selectNextUnrecordedDose([])).toBeNull();
  });

  it('does not depend on the order of the list it is given', () => {
    const doses = dayOf([morningNoonEvening]);

    expect(selectNextUnrecordedDose([...doses].reverse())?.time).toBe('08:00');
    expect(selectNextUnrecordedDose([...doses.slice(2), ...doses.slice(0, 2)])?.time).toBe('08:00');
  });

  it('picks by the same order as the day view when two medications share a time', () => {
    const zeta = makeMedication({
      id: 'med-z',
      name: 'Zeta',
      scheduleTimes: [{ id: 't1', timeOfDay: asLocalTime('08:00'), doseAmount: 1 }],
    });
    const alfa = makeMedication({
      id: 'med-a',
      name: 'Alfa',
      scheduleTimes: [{ id: 't1', timeOfDay: asLocalTime('08:00'), doseAmount: 1 }],
    });
    const doses = dayOf([zeta, alfa]);

    expect(selectNextUnrecordedDose(doses)?.medicationName).toBe('Alfa');
    expect(selectNextUnrecordedDose([...doses].reverse())?.medicationName).toBe('Alfa');
  });

  it('is only about the records, never about the time of day: a long-passed dose is still the answer', () => {
    // The function has no clock input. An unrecorded 08:00 dose is the answer whether it is
    // 07:00 or 23:00; this test documents that nothing but the list is read.
    expect(selectNextUnrecordedDose.length).toBe(1);
    expect(selectNextUnrecordedDose(dayOf([morningNoonEvening]))?.time).toBe('08:00');
  });

  it('does not change its input', () => {
    const doses = dayOf([morningNoonEvening]);
    const before = JSON.stringify(doses);

    selectNextUnrecordedDose(doses);

    expect(JSON.stringify(doses)).toBe(before);
  });
});
