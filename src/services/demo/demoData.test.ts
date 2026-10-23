import { describe, expect, it } from 'vitest';
import { classifyAppointment } from '@/features/appointments/logic/status';
import { generateScheduledDoses } from '@/features/doses/logic/scheduledDoses';
import { estimateStock } from '@/features/medications/logic/stock';
import { addDays, asLocalDate, asTimestamp } from '@/utils/date';
import { validateAppointment, validateDoseLog, validateMedication } from '../local/validation';
import { createDemoData, DEMO_ID_PREFIX, isDemoId } from './demoData';

const NOW = asTimestamp('2026-10-15T10:00:00Z');
const TODAY = asLocalDate('2026-10-15');
const input = { now: NOW, timeZone: 'Europe/Warsaw' };

describe('createDemoData', () => {
  const demo = createDemoData(input);

  it('is fully determined by its inputs', () => {
    expect(createDemoData(input)).toEqual(demo);
  });

  it('follows "today" in the given time zone, not the machine or UTC date', () => {
    // 22:30 UTC on the 15th is already the 16th in Warsaw.
    const lateEvening = createDemoData({
      now: asTimestamp('2026-10-15T22:30:00Z'),
      timeZone: 'Europe/Warsaw',
    });
    const utc = createDemoData({ now: asTimestamp('2026-10-15T22:30:00Z'), timeZone: 'UTC' });

    const startOf = (data: typeof demo) =>
      data.medications.find((medication) => medication.id === 'demo-medication-testovit')
        ?.startDate;
    expect(startOf(lateEvening)).toBe(addDays(asLocalDate('2026-10-16'), -20));
    expect(startOf(utc)).toBe(addDays(asLocalDate('2026-10-15'), -20));
  });

  it('contains only valid entities, so the repositories accept all of it', () => {
    for (const medication of demo.medications) expect(validateMedication(medication).ok).toBe(true);
    for (const log of demo.doseLogs) expect(validateDoseLog(log).ok).toBe(true);
    for (const appointment of demo.appointments)
      expect(validateAppointment(appointment).ok).toBe(true);
  });

  it('shows the new optional fields on some medications and leaves others as older data is: without them', () => {
    const byName = (name: string) =>
      demo.medications.find((medication) => medication.name === name);

    expect(byName('Demoxal')).toMatchObject({
      dosageForm: 'tablet',
      strength: { value: 500, unit: 'mg' },
    });
    expect(byName('Przykładyna')).toMatchObject({ dosageForm: 'liquid' });
    for (const name of ['Testovit', 'Dawnoxin']) {
      const medication = byName(name);
      expect(medication && 'dosageForm' in medication).toBe(false);
      expect(medication && 'strength' in medication).toBe(false);
    }
  });

  it('gives one medication an own low-stock threshold, in its stock unit, and the others none', () => {
    const withThreshold = demo.medications.filter((medication) => medication.lowStockThreshold);

    expect(withThreshold.map((medication) => medication.name)).toEqual(['Przykładyna']);
    for (const medication of withThreshold) {
      expect(medication.stock).not.toBeNull();
      expect(medication.lowStockThreshold?.unit).toBe(medication.stock?.unit);
    }
  });

  it('keeps the strength out of every unit: the dose and stock units are still plain units', () => {
    for (const medication of demo.medications) {
      expect(medication.doseUnit).not.toBe(medication.strength?.unit);
      expect(medication.stock === null || medication.stock.unit === medication.doseUnit).toBe(true);
    }
  });

  it('has one taken dose with an amount other than planned and a note, the plan kept beside it', () => {
    const different = demo.doseLogs.filter((log) => log.takenAmount !== undefined);

    expect(different).toHaveLength(1);
    expect(different[0]).toMatchObject({ status: 'taken', doseAmount: 1, takenAmount: 2 });
    expect(different[0]?.note).toContain('Dane fikcyjne');
    expect(demo.doseLogs.filter((log) => log.note !== undefined)).toHaveLength(1);
  });

  it('has unique ids and every intake record refers to a demo medication', () => {
    for (const collection of [demo.medications, demo.doseLogs, demo.appointments]) {
      const ids = collection.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const medicationIds = new Set(demo.medications.map((medication) => medication.id));
    expect(demo.doseLogs.every((log) => medicationIds.has(log.medicationId))).toBe(true);
  });

  it("marks everything as sample data through its ids, so it can be told apart from the user's own", () => {
    const all = [...demo.medications, ...demo.doseLogs, ...demo.appointments];
    expect(all.every((item) => item.id.startsWith(DEMO_ID_PREFIX))).toBe(true);
    expect(all.every((item) => isDemoId(item.id))).toBe(true);
    expect(isDemoId('0b0c9f6e-6a64-4b43-9c1e-5d6c8f1d2a3b')).toBe(false);
  });

  it('is clearly fictional: invented names, and notes that say so', () => {
    const names = demo.medications.map((medication) => medication.name);
    expect(names).toEqual(['Demoxal', 'Przykładyna', 'Testovit', 'Dawnoxin']);
    for (const medication of demo.medications) {
      expect(medication.notes === null || medication.notes.includes('fikcyjn')).toBe(true);
    }
    const doctors = demo.appointments.flatMap((appointment) => appointment.doctorName ?? []);
    expect(doctors.every((doctor) => /Przykładowsk|Testow|Demonstracyjn/.test(doctor))).toBe(true);
  });

  describe('is useful for the Stage 2 rules', () => {
    it('plans doses for today and leaves them all unrecorded', () => {
      const { doses } = generateScheduledDoses({
        medications: demo.medications,
        doseLogs: demo.doseLogs,
        date: TODAY,
      });

      expect(doses.map((dose) => `${dose.time} ${dose.medicationName}`)).toEqual([
        '07:30 Przykładyna',
        '08:00 Demoxal',
        '13:00 Testovit',
        '20:00 Demoxal',
      ]);
      expect(doses.every((dose) => dose.status === 'unrecorded')).toBe(true);
    });

    it('shows taken and skipped doses on past days', () => {
      const { doses } = generateScheduledDoses({
        medications: demo.medications,
        doseLogs: demo.doseLogs,
        date: addDays(TODAY, -2),
      });

      const demoxal = doses.filter((dose) => dose.medicationName === 'Demoxal');
      expect(demoxal.map((dose) => dose.status)).toEqual(['taken', 'skipped']);
    });

    it("keeps history of an older schedule visible outside the plan, and shows an ended medication's history as taken doses", () => {
      const day = (offset: number) =>
        generateScheduledDoses({
          medications: demo.medications,
          doseLogs: demo.doseLogs,
          date: addDays(TODAY, offset),
        });

      // Demoxal's schedule changed 10 days ago; its record from before that has no planned dose.
      const beforeChange = day(-12);
      expect(beforeChange.outsideSchedule.map((log) => log.medicationId)).toEqual([
        'demo-medication-demoxal',
      ]);
      // Dawnoxin was still being taken then: its record matches a planned dose.
      expect(
        beforeChange.doses
          .filter((dose) => dose.medicationName === 'Dawnoxin')
          .map((dose) => dose.status),
      ).toEqual(['taken']);
      // Once it ended it plans nothing, but its history is still stored.
      expect(day(-5).doses.some((dose) => dose.medicationName === 'Dawnoxin')).toBe(false);
      expect(
        demo.doseLogs.filter((log) => log.medicationId === 'demo-medication-dawnoxin'),
      ).toHaveLength(2);
    });

    it('covers stock estimates that are available and each kind that is not', () => {
      const estimateFor = (id: string) => {
        const medication = demo.medications.find((candidate) => candidate.id === id);
        if (!medication) throw new Error(`missing demo medication ${id}`);
        return estimateStock({ medication, doseLogs: demo.doseLogs, today: TODAY });
      };

      expect(estimateFor('demo-medication-demoxal')).toMatchObject({
        available: true,
        remaining: 28,
        daysRemaining: 14,
      });
      expect(estimateFor('demo-medication-przykladyna')).toMatchObject({
        available: true,
        remaining: 120,
        daysRemaining: 24,
      });
      expect(estimateFor('demo-medication-testovit')).toEqual({
        available: false,
        reason: 'no-stock',
      });
      expect(estimateFor('demo-medication-dawnoxin')).toEqual({
        available: false,
        reason: 'no-stock',
      });
    });

    it('has upcoming, needs-confirmation, completed and cancelled appointments', () => {
      const phases = demo.appointments.map(
        (appointment) => `${appointment.status}/${classifyAppointment(appointment, NOW)}`,
      );

      expect(phases.filter((phase) => phase === 'scheduled/upcoming')).toHaveLength(2);
      expect(phases).toContain('scheduled/needs-confirmation');
      expect(phases).toContain('completed/past');
      expect(phases).toContain('cancelled/past');
    });
  });
});
