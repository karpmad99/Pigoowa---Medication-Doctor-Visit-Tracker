import { describe, expect, it } from 'vitest';
import { generateScheduledDoses } from '@/features/doses/logic/scheduledDoses';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { endMedication } from './endMedication';
import { getMedicationStatus } from './status';

const NOW = asTimestamp('2026-10-15T10:00:00Z');

describe('endMedication', () => {
  const medication = makeMedication({
    startDate: asLocalDate('2026-01-01'),
    scheduleEffectiveFrom: asLocalDate('2026-03-01'),
    scheduleTimes: [scheduleTime('t-1', '08:00'), scheduleTime('t-2', '20:00')],
    stock: { quantity: 10, unit: 'tabletka', asOf: asTimestamp('2026-09-01T08:00:00Z') },
  });

  it('sets the end date and the update time, and changes nothing else', () => {
    const result = endMedication(medication, asLocalDate('2026-10-20'), NOW);

    expect(result).toEqual({
      ok: true,
      medication: { ...medication, endDate: '2026-10-20', updatedAt: NOW },
    });
  });

  it('does not modify the original medication', () => {
    endMedication(medication, asLocalDate('2026-10-20'), NOW);

    expect(medication.endDate).toBeNull();
  });

  it('allows the start day itself as the last day, but nothing earlier', () => {
    expect(endMedication(medication, asLocalDate('2026-01-01'), NOW).ok).toBe(true);
    expect(endMedication(medication, asLocalDate('2025-12-31'), NOW)).toEqual({
      ok: false,
      error: 'before-start',
    });
  });

  it('plans doses up to and including the end date and none after it', () => {
    const result = endMedication(medication, asLocalDate('2026-10-20'), NOW);
    if (!result.ok) throw new Error('should be allowed');
    const dosesOn = (date: string) =>
      generateScheduledDoses({
        medications: [result.medication],
        doseLogs: [],
        date: asLocalDate(date),
      }).doses.length;

    expect(dosesOn('2026-10-19')).toBe(2);
    expect(dosesOn('2026-10-20')).toBe(2);
    expect(dosesOn('2026-10-21')).toBe(0);
    expect(dosesOn('2027-01-01')).toBe(0);
  });

  it('keeps recorded history visible: records after the end date stay as history, none are rewritten', () => {
    const afterEnd = makeDoseLog({
      id: 'l-after',
      scheduledDate: asLocalDate('2026-10-22'),
      doseAmount: 3,
      doseUnit: 'kapsułka',
    });
    const beforeEnd = makeDoseLog({ id: 'l-before', scheduledDate: asLocalDate('2026-10-19') });
    const logs = [afterEnd, beforeEnd];
    const snapshot = JSON.stringify(logs);
    const result = endMedication(medication, asLocalDate('2026-10-20'), NOW);
    if (!result.ok) throw new Error('should be allowed');

    const afterDay = generateScheduledDoses({
      medications: [result.medication],
      doseLogs: logs,
      date: asLocalDate('2026-10-22'),
    });
    const beforeDay = generateScheduledDoses({
      medications: [result.medication],
      doseLogs: logs,
      date: asLocalDate('2026-10-19'),
    });

    expect(afterDay.doses).toEqual([]);
    expect(afterDay.outsideSchedule).toEqual([afterEnd]);
    expect(beforeDay.doses.find((dose) => dose.time === '08:00')?.status).toBe('taken');
    expect(JSON.stringify(logs)).toBe(snapshot);
  });

  it('turns the status to ended the day after', () => {
    const result = endMedication(medication, asLocalDate('2026-10-14'), NOW);
    if (!result.ok) throw new Error('should be allowed');

    expect(getMedicationStatus(result.medication, asLocalDate('2026-10-15'))).toBe('ended');
  });
});
