import { describe, expect, it } from 'vitest';
import { makeDoseLog, makeMedication } from '@/test/fixtures';
import { asLocalDate, asLocalTime } from '@/utils/date';
import { summarizeDay } from './daySummary';
import { generateScheduledDoses } from './scheduledDoses';

describe('summarizeDay', () => {
  it('counts taken, skipped and unrecorded doses separately and never merges unrecorded into skipped', () => {
    const date = asLocalDate('2026-10-15');
    const med = makeMedication({
      scheduleTimes: [
        { id: 't1', timeOfDay: asLocalTime('08:00'), doseAmount: 1 },
        { id: 't2', timeOfDay: asLocalTime('14:00'), doseAmount: 1 },
        { id: 't3', timeOfDay: asLocalTime('20:00'), doseAmount: 1 },
      ],
    });
    const { doses } = generateScheduledDoses({
      medications: [med],
      doseLogs: [
        makeDoseLog({ id: 'a', scheduledTime: asLocalTime('08:00'), status: 'taken' }),
        makeDoseLog({ id: 'b', scheduledTime: asLocalTime('14:00'), status: 'skipped' }),
      ],
      date,
    });

    expect(summarizeDay(doses)).toEqual({ total: 3, taken: 1, skipped: 1, unrecorded: 1 });
  });

  it('is all zero for an empty day', () => {
    expect(summarizeDay([])).toEqual({ total: 0, taken: 0, skipped: 0, unrecorded: 0 });
  });
});
