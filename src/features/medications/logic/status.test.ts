import { describe, expect, it } from 'vitest';
import { asLocalDate } from '@/utils/date';
import { makeMedication } from '@/test/fixtures';
import { getMedicationStatus } from './status';

const TODAY = asLocalDate('2026-10-15');

describe('getMedicationStatus', () => {
  it('is active from the start date through the end date, inclusive', () => {
    const open = makeMedication({ startDate: asLocalDate('2026-10-15'), endDate: null });
    const endsToday = makeMedication({ startDate: asLocalDate('2026-01-01'), endDate: TODAY });

    expect(getMedicationStatus(open, TODAY)).toBe('active');
    expect(getMedicationStatus(endsToday, TODAY)).toBe('active');
  });

  it('is ended the day after the end date, never before', () => {
    const medication = makeMedication({ endDate: asLocalDate('2026-10-14') });

    expect(getMedicationStatus(medication, TODAY)).toBe('ended');
    expect(getMedicationStatus(medication, asLocalDate('2026-10-14'))).toBe('active');
  });

  it('is planned until the start date is reached', () => {
    const medication = makeMedication({
      startDate: asLocalDate('2026-10-16'),
      scheduleEffectiveFrom: asLocalDate('2026-10-16'),
    });

    expect(getMedicationStatus(medication, TODAY)).toBe('planned');
    expect(getMedicationStatus(medication, asLocalDate('2026-10-16'))).toBe('active');
  });
});
