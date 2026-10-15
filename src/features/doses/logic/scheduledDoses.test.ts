import { describe, expect, it } from 'vitest';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { generateScheduledDoses } from './scheduledDoses';

const DATE = asLocalDate('2026-10-15');

function dosesFor(
  medications: Parameters<typeof generateScheduledDoses>[0]['medications'],
  doseLogs: Parameters<typeof generateScheduledDoses>[0]['doseLogs'] = [],
  date = DATE,
) {
  return generateScheduledDoses({ medications, doseLogs, date });
}

describe('generateScheduledDoses', () => {
  it('gives one dose for a medication taken once daily', () => {
    const { doses } = dosesFor([makeMedication()]);

    expect(doses).toEqual([
      {
        medicationId: 'med-1',
        medicationName: 'Lek A',
        date: DATE,
        time: '08:00',
        doseAmount: 1,
        doseUnit: 'tabletka',
        status: 'unrecorded',
        log: null,
      },
    ]);
  });

  it('gives one dose per time for a medication taken several times daily, each with its own amount', () => {
    const medication = makeMedication({
      scheduleTimes: [
        scheduleTime('t-3', '22:00', 1),
        scheduleTime('t-1', '08:00', 2),
        scheduleTime('t-2', '14:00', 1.5),
      ],
    });

    const { doses } = dosesFor([medication]);

    expect(doses.map((dose) => [dose.time, dose.doseAmount])).toEqual([
      ['08:00', 2],
      ['14:00', 1.5],
      ['22:00', 1],
    ]);
  });

  it('does not touch the stored schedule or create records', () => {
    const medication = makeMedication();
    const logs = [makeDoseLog({ scheduledDate: asLocalDate('2026-10-14') })];

    dosesFor([medication], logs);

    expect(medication.scheduleTimes).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  describe('active date range', () => {
    const medication = makeMedication({
      startDate: asLocalDate('2026-10-10'),
      endDate: asLocalDate('2026-10-20'),
      scheduleEffectiveFrom: asLocalDate('2026-10-10'),
    });

    it('generates doses on the first and last day, inclusive', () => {
      expect(dosesFor([medication], [], asLocalDate('2026-10-10')).doses).toHaveLength(1);
      expect(dosesFor([medication], [], asLocalDate('2026-10-20')).doses).toHaveLength(1);
    });

    it('generates nothing the day before the start or the day after the end', () => {
      expect(dosesFor([medication], [], asLocalDate('2026-10-09')).doses).toEqual([]);
      expect(dosesFor([medication], [], asLocalDate('2026-10-21')).doses).toEqual([]);
    });

    it('generates nothing for a medication with no usable schedule', () => {
      const empty = makeMedication({ scheduleTimes: [] });
      expect(dosesFor([empty]).doses).toEqual([]);
    });

    it('works across 29 February in a leap year', () => {
      const leap = makeMedication({
        endDate: asLocalDate('2024-03-01'),
        startDate: asLocalDate('2024-01-01'),
        scheduleEffectiveFrom: asLocalDate('2024-01-01'),
      });
      expect(dosesFor([leap], [], asLocalDate('2024-02-29')).doses).toHaveLength(1);
      expect(dosesFor([leap], [], asLocalDate('2024-03-02')).doses).toHaveLength(0);
    });
  });

  describe('schedule change with scheduleEffectiveFrom', () => {
    // The schedule used to be 08:00 only; on 2026-10-15 an evening dose was added.
    const medication = makeMedication({
      scheduleEffectiveFrom: asLocalDate('2026-10-15'),
      scheduleTimes: [scheduleTime('t-1', '08:00'), scheduleTime('t-2', '20:00')],
    });
    const oldLog = makeDoseLog({
      scheduledDate: asLocalDate('2026-10-14'),
      scheduledTime: asLocalTime('08:00'),
    });

    it('generates no planned doses before the effective date, so no phantom "unrecorded" doses appear in the past', () => {
      const yesterday = dosesFor([medication], [oldLog], asLocalDate('2026-10-14'));
      expect(yesterday.doses).toEqual([]);
    });

    it('still shows what was recorded before the change, as history outside the current schedule', () => {
      const yesterday = dosesFor([medication], [oldLog], asLocalDate('2026-10-14'));
      expect(yesterday.outsideSchedule).toEqual([oldLog]);
    });

    it('uses the new schedule from the effective date onwards', () => {
      expect(dosesFor([medication], [], asLocalDate('2026-10-15')).doses).toHaveLength(2);
      expect(dosesFor([medication], [], asLocalDate('2026-10-16')).doses).toHaveLength(2);
    });
  });

  describe('status from intake records', () => {
    const medication = makeMedication({
      scheduleTimes: [
        scheduleTime('t-1', '08:00'),
        scheduleTime('t-2', '14:00'),
        scheduleTime('t-3', '20:00'),
      ],
    });

    it('distinguishes taken, skipped and unrecorded', () => {
      const taken = makeDoseLog({
        id: 'l-1',
        scheduledTime: asLocalTime('08:00'),
        status: 'taken',
      });
      const skipped = makeDoseLog({
        id: 'l-2',
        scheduledTime: asLocalTime('14:00'),
        status: 'skipped',
      });

      const { doses } = dosesFor([medication], [taken, skipped]);

      expect(doses.map((dose) => dose.status)).toEqual(['taken', 'skipped', 'unrecorded']);
      expect(doses[0]?.log).toBe(taken);
      expect(doses[1]?.log).toBe(skipped);
      expect(doses[2]?.log).toBeNull();
    });

    it('matches only the same medication, date and time', () => {
      const logs = [
        makeDoseLog({ id: 'other-med', medicationId: 'med-2' }),
        makeDoseLog({ id: 'other-day', scheduledDate: asLocalDate('2026-10-16') }),
        makeDoseLog({ id: 'other-time', scheduledTime: asLocalTime('09:00') }),
      ];

      const { doses } = dosesFor([medication], logs);

      expect(doses.every((dose) => dose.status === 'unrecorded')).toBe(true);
    });

    it('lists records that match no planned dose separately, in a fixed order', () => {
      const orphanLate = makeDoseLog({ id: 'l-b', scheduledTime: asLocalTime('21:30') });
      const orphanEarly = makeDoseLog({ id: 'l-a', scheduledTime: asLocalTime('06:15') });
      const deletedMedication = makeDoseLog({
        id: 'l-c',
        medicationId: 'gone',
        scheduledTime: asLocalTime('08:00'),
      });

      const { outsideSchedule } = dosesFor(
        [medication],
        [orphanLate, deletedMedication, orphanEarly],
      );

      expect(outsideSchedule.map((log) => log.id)).toEqual(['l-a', 'l-c', 'l-b']);
    });

    it('keeps a record of an ended medication visible outside the schedule', () => {
      const ended = makeMedication({ endDate: asLocalDate('2026-10-10') });
      const log = makeDoseLog();

      const result = dosesFor([ended], [log]);

      expect(result.doses).toEqual([]);
      expect(result.outsideSchedule).toEqual([log]);
    });
  });

  describe('duplicate and invalid schedule slots', () => {
    it('generates one dose when two schedule entries share a time, using the smallest id', () => {
      const medication = makeMedication({
        scheduleTimes: [scheduleTime('t-b', '08:00', 5), scheduleTime('t-a', '08:00', 1)],
      });

      const { doses } = dosesFor([medication]);

      expect(doses).toHaveLength(1);
      expect(doses[0]?.doseAmount).toBe(1);
    });

    it('skips entries with an unusable amount', () => {
      const medication = makeMedication({
        scheduleTimes: [scheduleTime('t-1', '08:00', 0), scheduleTime('t-2', '12:00', 1)],
      });

      expect(dosesFor([medication]).doses.map((dose) => dose.time)).toEqual(['12:00']);
    });

    it('shows the most recently recorded of several records for one slot (corrupt data), deterministically', () => {
      const older = makeDoseLog({
        id: 'l-1',
        status: 'taken',
        recordedAt: asTimestamp('2026-10-15T06:00:00Z'),
      });
      const newer = makeDoseLog({
        id: 'l-2',
        status: 'skipped',
        recordedAt: asTimestamp('2026-10-15T07:00:00Z'),
      });

      const forward = dosesFor([makeMedication()], [older, newer]);
      const backward = dosesFor([makeMedication()], [newer, older]);

      expect(forward.doses[0]?.status).toBe('skipped');
      expect(backward.doses[0]?.status).toBe('skipped');
      expect(forward.outsideSchedule).toEqual([]);
    });

    it('breaks a tie between such records recorded at the same instant by the highest id', () => {
      const recordedAt = asTimestamp('2026-10-15T06:00:00Z');
      const lowId = makeDoseLog({ id: 'l-1', status: 'taken', recordedAt });
      const highId = makeDoseLog({ id: 'l-2', status: 'skipped', recordedAt });

      expect(dosesFor([makeMedication()], [lowId, highId]).doses[0]?.log).toBe(highId);
      expect(dosesFor([makeMedication()], [highId, lowId]).doses[0]?.log).toBe(highId);
    });
  });

  describe('ordering', () => {
    it('orders by time, then by name, then by medication id', () => {
      const medications = [
        makeMedication({ id: 'm-3', name: 'Beta', scheduleTimes: [scheduleTime('t', '08:00')] }),
        makeMedication({ id: 'm-2', name: 'Alfa', scheduleTimes: [scheduleTime('t', '20:00')] }),
        makeMedication({ id: 'm-5', name: 'Alfa', scheduleTimes: [scheduleTime('t', '08:00')] }),
        makeMedication({ id: 'm-1', name: 'Alfa', scheduleTimes: [scheduleTime('t', '08:00')] }),
      ];

      const { doses } = dosesFor(medications);

      expect(
        doses.map((dose) => `${dose.time} ${dose.medicationName} ${dose.medicationId}`),
      ).toEqual(['08:00 Alfa m-1', '08:00 Alfa m-5', '08:00 Beta m-3', '20:00 Alfa m-2']);
    });

    it('does not depend on the order of the input', () => {
      const a = makeMedication({
        id: 'm-a',
        name: 'Alfa',
        scheduleTimes: [scheduleTime('t-1', '08:00'), scheduleTime('t-2', '20:00')],
      });
      const b = makeMedication({
        id: 'm-b',
        name: 'Beta',
        scheduleTimes: [scheduleTime('t-3', '08:00')],
      });

      expect(dosesFor([a, b])).toEqual(dosesFor([b, a]));
    });

    it('sorts names using Polish alphabet rules (Cz comes before Ćm)', () => {
      const medications = [
        makeMedication({ id: 'm-1', name: 'Ćmik' }),
        makeMedication({ id: 'm-2', name: 'Czop' }),
      ];

      expect(dosesFor(medications).doses.map((dose) => dose.medicationName)).toEqual([
        'Czop',
        'Ćmik',
      ]);
    });
  });

  describe('daylight-saving transitions', () => {
    // Schedule times are wall-clock values: "02:30" stays "02:30" and is generated exactly once,
    // even on the nights when 02:30 does not exist or happens twice. Such a dose is merely a
    // planned time label; recording it never needs an instant for 02:30.
    const nightDose = makeMedication({ scheduleTimes: [scheduleTime('t-1', '02:30')] });

    it.each([
      ['clocks go forward (02:30 does not exist)', '2026-03-29'],
      ['clocks go back (02:30 happens twice)', '2026-10-25'],
      ['an ordinary night', '2026-07-01'],
    ])('generates the 02:30 dose exactly once when %s', (_label, date) => {
      const { doses } = dosesFor([nightDose], [], asLocalDate(date));

      expect(doses).toHaveLength(1);
      expect(doses[0]?.time).toBe('02:30');
      expect(doses[0]?.date).toBe(date);
    });
  });

  it('does not modify its inputs', () => {
    const medications = [
      makeMedication({
        scheduleTimes: [scheduleTime('t-2', '20:00'), scheduleTime('t-1', '08:00')],
      }),
    ];
    const logs = [makeDoseLog()];
    const medicationsBefore = JSON.stringify(medications);
    const logsBefore = JSON.stringify(logs);

    dosesFor(medications, logs);

    expect(JSON.stringify(medications)).toBe(medicationsBefore);
    expect(JSON.stringify(logs)).toBe(logsBefore);
  });
});
