import { describe, expect, it } from 'vitest';
import { makeDoseLog, makeMedication, scheduleTime } from '@/test/fixtures';
import { asLocalDate, asLocalTime } from '@/utils/date';
import {
  filterHistory,
  findOutsideScheduleReasons,
  groupByDate,
  isRangeReversed,
  NO_HISTORY_FILTERS,
  outsideScheduleReason,
  sortHistory,
} from './history';

const d = asLocalDate;

describe('outsideScheduleReason', () => {
  const medication = makeMedication({
    id: 'med-1',
    startDate: d('2026-09-01'),
    scheduleEffectiveFrom: d('2026-10-05'),
    endDate: d('2026-10-20'),
    scheduleTimes: [scheduleTime('t-1', '08:00'), scheduleTime('t-2', '20:00')],
  });
  const log = (overrides: Parameters<typeof makeDoseLog>[0]) =>
    makeDoseLog({ medicationId: 'med-1', ...overrides });

  it('is null for a record that matches a dose of the current schedule', () => {
    expect(outsideScheduleReason(medication, log({ scheduledDate: d('2026-10-10') }))).toBeNull();
    expect(
      outsideScheduleReason(
        medication,
        log({ scheduledDate: d('2026-10-10'), scheduledTime: asLocalTime('20:00') }),
      ),
    ).toBeNull();
  });

  it('says the medication was removed when there is no medication', () => {
    expect(outsideScheduleReason(undefined, log({}))).toBe('medication-removed');
  });

  it('says the schedule was changed later for a day before it took effect', () => {
    expect(outsideScheduleReason(medication, log({ scheduledDate: d('2026-10-04') }))).toBe(
      'before-schedule-change',
    );
  });

  it('says the day is before the start date, which wins over the schedule change', () => {
    expect(outsideScheduleReason(medication, log({ scheduledDate: d('2026-08-31') }))).toBe(
      'before-start',
    );
  });

  it('says the day is after the end date', () => {
    expect(outsideScheduleReason(medication, log({ scheduledDate: d('2026-10-21') }))).toBe(
      'after-end',
    );
  });

  it('says the time is not in the schedule when the medication was active that day', () => {
    expect(
      outsideScheduleReason(
        medication,
        log({ scheduledDate: d('2026-10-10'), scheduledTime: asLocalTime('12:00') }),
      ),
    ).toBe('time-not-in-schedule');
  });

  it('agrees with the end date being the last planned day', () => {
    expect(outsideScheduleReason(medication, log({ scheduledDate: d('2026-10-20') }))).toBeNull();
  });
});

describe('findOutsideScheduleReasons', () => {
  it('keys the reasons by record id and leaves matching records out', () => {
    const med = makeMedication({ id: 'med-1', scheduleEffectiveFrom: d('2026-10-10') });
    const inSchedule = makeDoseLog({ id: 'in', scheduledDate: d('2026-10-12') });
    const old = makeDoseLog({ id: 'old', scheduledDate: d('2026-10-01') });
    const orphan = makeDoseLog({ id: 'orphan', medicationId: 'gone' });

    const reasons = findOutsideScheduleReasons([med], [inSchedule, old, orphan]);

    expect([...reasons.entries()]).toEqual([
      ['old', 'before-schedule-change'],
      ['orphan', 'medication-removed'],
    ]);
  });

  it('does not modify the records', () => {
    const med = makeMedication({ id: 'med-1' });
    const logs = [makeDoseLog({ id: 'a' })];
    const snapshot = structuredClone(logs);
    findOutsideScheduleReasons([med], logs);
    expect(logs).toEqual(snapshot);
  });
});

describe('filterHistory', () => {
  const logs = [
    makeDoseLog({ id: '1', medicationId: 'a', scheduledDate: d('2026-10-01'), status: 'taken' }),
    makeDoseLog({ id: '2', medicationId: 'a', scheduledDate: d('2026-10-05'), status: 'skipped' }),
    makeDoseLog({ id: '3', medicationId: 'b', scheduledDate: d('2026-10-05'), status: 'taken' }),
    makeDoseLog({ id: '4', medicationId: 'b', scheduledDate: d('2026-10-10'), status: 'taken' }),
  ];
  const ids = (result: readonly { id: string }[]) => result.map((log) => log.id);

  it('without filters returns everything', () => {
    expect(ids(filterHistory(logs, NO_HISTORY_FILTERS))).toEqual(['1', '2', '3', '4']);
  });

  it('includes both ends of the date range', () => {
    const range = { ...NO_HISTORY_FILTERS, from: d('2026-10-05'), to: d('2026-10-10') };
    expect(ids(filterHistory(logs, range))).toEqual(['2', '3', '4']);
  });

  it('accepts a range with only one end', () => {
    expect(ids(filterHistory(logs, { ...NO_HISTORY_FILTERS, from: d('2026-10-06') }))).toEqual([
      '4',
    ]);
    expect(ids(filterHistory(logs, { ...NO_HISTORY_FILTERS, to: d('2026-10-01') }))).toEqual(['1']);
  });

  it('filters by medication and by status, and combines filters with "and"', () => {
    expect(ids(filterHistory(logs, { ...NO_HISTORY_FILTERS, medicationId: 'b' }))).toEqual([
      '3',
      '4',
    ]);
    expect(ids(filterHistory(logs, { ...NO_HISTORY_FILTERS, status: 'skipped' }))).toEqual(['2']);
    expect(
      ids(filterHistory(logs, { ...NO_HISTORY_FILTERS, medicationId: 'a', status: 'taken' })),
    ).toEqual(['1']);
  });

  it('returns nothing for a reversed range, and says it is reversed', () => {
    const reversed = { ...NO_HISTORY_FILTERS, from: d('2026-10-10'), to: d('2026-10-01') };
    expect(isRangeReversed(reversed)).toBe(true);
    expect(filterHistory(logs, reversed)).toEqual([]);
    expect(isRangeReversed({ from: d('2026-10-01'), to: d('2026-10-01') })).toBe(false);
    expect(isRangeReversed({ from: null, to: d('2026-10-01') })).toBe(false);
  });

  it('does not modify its input', () => {
    const snapshot = structuredClone(logs);
    filterHistory(logs, { ...NO_HISTORY_FILTERS, status: 'taken' });
    expect(logs).toEqual(snapshot);
  });
});

describe('sortHistory and groupByDate', () => {
  const names: Record<string, string> = { a: 'Żółw', b: 'Ąbc', c: 'Bec' };
  const nameOf = (id: string) => names[id] ?? '';
  const log = (id: string, medicationId: string, date: string, time: string) =>
    makeDoseLog({
      id,
      medicationId,
      scheduledDate: d(date),
      scheduledTime: asLocalTime(time),
    });

  it('puts the newest day first and the earliest time first within a day', () => {
    const sorted = sortHistory(
      [
        log('1', 'a', '2026-10-01', '08:00'),
        log('2', 'a', '2026-10-03', '20:00'),
        log('3', 'a', '2026-10-03', '08:00'),
      ],
      nameOf,
    );
    expect(sorted.map((l) => l.id)).toEqual(['3', '2', '1']);
  });

  it('breaks ties by Polish medication name, then ids, so the order is stable', () => {
    const sorted = sortHistory(
      [
        log('x2', 'a', '2026-10-03', '08:00'),
        log('x1', 'c', '2026-10-03', '08:00'),
        log('x3', 'b', '2026-10-03', '08:00'),
        log('x0', 'b', '2026-10-03', '08:00'),
      ],
      nameOf,
    );
    // Ąbc (b), Bec (c), Żółw (a); the two records of b by id.
    expect(sorted.map((l) => l.id)).toEqual(['x0', 'x3', 'x1', 'x2']);
  });

  it('does not modify its input and groups consecutive days', () => {
    const input = [
      log('1', 'a', '2026-10-01', '08:00'),
      log('2', 'a', '2026-10-03', '08:00'),
      log('3', 'b', '2026-10-03', '09:00'),
    ];
    const snapshot = structuredClone(input);
    const sorted = sortHistory(input, nameOf);
    expect(input).toEqual(snapshot);

    const days = groupByDate(sorted);
    expect(days.map((day) => [day.date, day.logs.map((l) => l.id)])).toEqual([
      ['2026-10-03', ['2', '3']],
      ['2026-10-01', ['1']],
    ]);
  });

  it('gives no days for no records', () => {
    expect(groupByDate([])).toEqual([]);
  });
});
