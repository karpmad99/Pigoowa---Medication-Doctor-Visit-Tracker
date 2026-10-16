import { describe, expect, it } from 'vitest';
import { estimateStock } from '@/features/medications/logic/stock';
import type { Medication } from '@/features/medications/types';
import type { AppServices } from '@/services/repositories';
import { makeMedication, scheduleTime } from '@/test/fixtures';
import { createTestServices, TEST_TIME_ZONE } from '@/test/services';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { applyDoseAction, type DoseTarget } from './applyDoseAction';
import { generateScheduledDoses } from './logic/scheduledDoses';
import type { ScheduledDose } from './types';

// What `recordedAt` means, and what it does to the stock estimate.
//
// `DoseLog.recordedAt` is "when the user recorded (or last changed) it" (types.ts, DATABASE.md,
// PROJECT_SPEC §7.2). The stock estimate (§7.3) counts a TAKEN record when `recordedAt >= stock.asOf`:
// it asks "was this dose recorded after the stock was counted?", not "was it scheduled after?".
// These tests run the real recording code path (`applyDoseAction` on the local repositories) at
// chosen moments and check the estimate after each step, so the consequences are pinned down.
//
// The timeline: the stock (10 tablets) was counted at 12:00 Warsaw time on 15 October 2026.
// Doses are planned for 08:00 and 20:00.

const DAY = asLocalDate('2026-10-15');
const COUNTED_AT = asTimestamp('2026-10-15T10:00:00Z'); // 12:00 in Warsaw
const MORNING = asTimestamp('2026-10-15T06:05:00Z'); // 08:05 local: before the count
const EVENING = asTimestamp('2026-10-15T18:05:00Z'); // 20:05 local: after the count
const NEXT_MORNING = asTimestamp('2026-10-16T06:30:00Z');

async function setup() {
  const services = createTestServices();
  const medication = makeMedication({
    id: 'med-1',
    name: 'Lek A',
    doseUnit: 'tabletka',
    scheduleTimes: [scheduleTime('t-1', '08:00', 1), scheduleTime('t-2', '20:00', 1)],
    stock: { quantity: 10, unit: 'tabletka', asOf: COUNTED_AT },
  });
  await services.repositories.medications.create(medication);
  return { services, medication };
}

async function doseAt(services: AppServices, time: string): Promise<ScheduledDose> {
  const medications = await services.repositories.medications.list();
  const doseLogs = await services.repositories.doseLogs.listByDateRange(DAY, DAY);
  const found = generateScheduledDoses({ medications, doseLogs, date: DAY }).doses.find(
    (dose) => dose.time === time,
  );
  if (found === undefined) throw new Error(`No dose at ${time}`);
  return found;
}

/** Performs the action as the day view does, at the given moment. */
async function act(services: AppServices, time: string, target: DoseTarget, now: string) {
  return applyDoseAction({
    repositories: services.repositories,
    dose: await doseAt(services, time),
    target,
    now: asTimestamp(now),
    timeZone: TEST_TIME_ZONE,
    createId: services.createId,
  });
}

async function remaining(services: AppServices, medication?: Medication) {
  const current = medication ?? (await services.repositories.medications.get('med-1'));
  const logs = await services.repositories.doseLogs.listByDateRange(
    asLocalDate('2000-01-01'),
    asLocalDate('2999-12-31'),
  );
  const estimate = estimateStock({ medication: current, doseLogs: logs, today: DAY });
  if (!estimate.available) throw new Error(`Unexpectedly unavailable: ${estimate.reason}`);
  return estimate.remaining;
}

const allLogs = (services: AppServices) =>
  services.repositories.doseLogs.listByDateRange(
    asLocalDate('2000-01-01'),
    asLocalDate('2999-12-31'),
  );

describe('stock and recording: what reduces the estimate', () => {
  it('counts a taken dose recorded after the stock was counted, exactly once', async () => {
    const { services } = await setup();
    expect(await remaining(services)).toBe(10);

    await act(services, '20:00', 'taken', EVENING);

    expect(await remaining(services)).toBe(9);
  });

  it('does not count a skipped dose, and not a dose that was never recorded', async () => {
    const { services } = await setup();

    await act(services, '20:00', 'skipped', EVENING);

    expect(await remaining(services)).toBe(10);
    expect((await doseAt(services, '08:00')).status).toBe('unrecorded');
  });

  it('gives the stock back when a taken dose is changed to skipped, and takes it again when changed back', async () => {
    const { services } = await setup();
    await act(services, '20:00', 'taken', EVENING);
    expect(await remaining(services)).toBe(9);

    await act(services, '20:00', 'skipped', '2026-10-15T18:10:00Z');
    expect(await remaining(services)).toBe(10);

    await act(services, '20:00', 'taken', '2026-10-15T18:15:00Z');
    expect(await remaining(services)).toBe(9); // once, not twice: it is the same single record
    expect(await allLogs(services)).toHaveLength(1);
  });

  it('gives the stock back when a taken dose is cleared, and counts a new record afterwards', async () => {
    const { services } = await setup();
    await act(services, '20:00', 'taken', EVENING);

    await act(services, '20:00', 'clear', '2026-10-15T18:10:00Z');
    expect(await remaining(services)).toBe(10);
    expect(await allLogs(services)).toEqual([]);

    await act(services, '20:00', 'taken', '2026-10-15T18:20:00Z');
    expect(await remaining(services)).toBe(9);
  });

  it('subtracts the amount recorded, not what the schedule says today', async () => {
    const { services, medication } = await setup();
    await act(services, '20:00', 'taken', EVENING);
    await services.repositories.medications.update({
      ...medication,
      scheduleTimes: [scheduleTime('t-1', '08:00', 3), scheduleTime('t-2', '20:00', 3)],
    });

    expect(await remaining(services)).toBe(9);
  });

  it('adds up several taken doses, each with its own recorded amount', async () => {
    const { services, medication } = await setup();
    await act(services, '20:00', 'taken', EVENING);
    await services.repositories.medications.update({
      ...medication,
      scheduleTimes: [scheduleTime('t-1', '08:00', 2), scheduleTime('t-2', '20:00', 1)],
    });
    // Next day, with the new amount of 2 at 08:00.
    const medications = await services.repositories.medications.list();
    const nextDay = asLocalDate('2026-10-16');
    const dose = generateScheduledDoses({
      medications,
      doseLogs: [],
      date: nextDay,
    }).doses.find((entry) => entry.time === '08:00');
    if (dose === undefined) throw new Error('no dose');
    await applyDoseAction({
      repositories: services.repositories,
      dose,
      target: 'taken',
      now: NEXT_MORNING,
      timeZone: TEST_TIME_ZONE,
      createId: services.createId,
    });

    expect(await remaining(services)).toBe(7);
  });
});

describe('stock and recording: what recordedAt does', () => {
  it('records the moment of the action, and moves it on a change of status but not on a repeat', async () => {
    const { services } = await setup();
    await act(services, '20:00', 'taken', EVENING);
    const [first] = await allLogs(services);
    expect(first?.recordedAt).toBe(EVENING);

    await act(services, '20:00', 'taken', '2026-10-15T18:30:00Z'); // the same status again
    expect((await allLogs(services))[0]?.recordedAt).toBe(EVENING);

    await act(services, '20:00', 'skipped', '2026-10-15T18:40:00Z');
    const [changed] = await allLogs(services);
    expect(changed?.recordedAt).toBe('2026-10-15T18:40:00.000Z');
    expect(changed?.id).toBe(first?.id);
  });

  it('decides what counts by when the dose was RECORDED, not by its scheduled time (documented heuristic)', async () => {
    // The 08:00 dose was taken in the morning, BEFORE the 12:00 count, but is only entered at 14:00.
    // The app cannot know that the count already reflects it, so it counts it again.
    const { services } = await setup();

    await act(services, '08:00', 'taken', '2026-10-15T12:00:00Z');

    expect(await remaining(services)).toBe(9);
  });

  it('does not count a dose that was recorded before the stock was counted', async () => {
    const { services } = await setup();

    await act(services, '08:00', 'taken', MORNING);

    expect(await remaining(services)).toBe(10);
  });

  it('a correction after the count makes an earlier record count (documented limitation, PROJECT_SPEC §7.3)', async () => {
    const { services } = await setup();
    await act(services, '08:00', 'taken', MORNING);
    expect(await remaining(services)).toBe(10); // recorded before the count: not counted

    await act(services, '08:00', 'skipped', EVENING); // corrected later ...
    expect(await remaining(services)).toBe(10); // ... skipped never counts
    await act(services, '08:00', 'taken', '2026-10-15T18:10:00Z'); // ... and back again
    // `recordedAt` is "last changed", so the record is now newer than the count.
    expect(await remaining(services)).toBe(9);
  });

  it('entering the stock again starts the count afresh, which is the way to correct such a case', async () => {
    const { services, medication } = await setup();
    await act(services, '08:00', 'taken', '2026-10-15T12:00:00Z');
    expect(await remaining(services)).toBe(9);

    // The user re-enters what they really have, now.
    const recount = { quantity: 10, unit: 'tabletka', asOf: asTimestamp('2026-10-15T12:30:00Z') };
    await services.repositories.medications.update({ ...medication, stock: recount });

    expect(await remaining(services)).toBe(10);
  });

  it('counts a record made at the very moment the stock was counted (the boundary is inclusive)', async () => {
    const { services } = await setup();

    await act(services, '20:00', 'taken', COUNTED_AT);

    expect(await remaining(services)).toBe(9);
  });

  it('never goes below zero, and never shows an unavailable estimate as zero', async () => {
    const { services, medication } = await setup();
    await services.repositories.medications.update({
      ...medication,
      stock: { quantity: 1, unit: 'tabletka', asOf: COUNTED_AT },
    });
    await act(services, '20:00', 'taken', EVENING);
    expect(await remaining(services)).toBe(0);

    const noStock = { ...medication, stock: null };
    expect(
      estimateStock({ medication: noStock, doseLogs: await allLogs(services), today: DAY }),
    ).toEqual({ available: false, reason: 'no-stock' });
  });
});
