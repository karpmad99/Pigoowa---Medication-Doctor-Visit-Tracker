import { describe, expect, it } from 'vitest';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import {
  makeAppointment,
  makeDoseLog,
  makeMedication,
  makeStockEvent,
  scheduleTime,
} from '@/test/fixtures';
import { RepositoryError } from '../errors';
import {
  appointmentFromRow,
  appointmentToRow,
  doseLogFromRow,
  doseLogToRow,
  medicationFromRows,
  medicationToRow,
  scheduleTimeToRow,
  stockEventFromRow,
  stockEventToRow,
  type MedicationRow,
  type ScheduleTimeRow,
} from './mappers';

const USER = '11111111-1111-4111-8111-111111111111';
const MED = '22222222-2222-4222-8222-222222222222';

function medicationRow(overrides: Partial<MedicationRow> = {}): MedicationRow {
  return {
    id: MED,
    user_id: USER,
    name: 'Lek A',
    dose_unit: 'tabletka',
    notes: null,
    start_date: '2026-01-01',
    end_date: null,
    schedule_effective_from: '2026-01-01',
    stock_quantity: null,
    stock_unit: null,
    stock_as_of: null,
    stock_basis: null,
    dosage_form: null,
    strength_value: null,
    strength_unit: null,
    low_stock_threshold: null,
    low_stock_threshold_unit: null,
    created_at: '2026-01-01T08:00:00+00:00',
    updated_at: '2026-01-01T08:00:00+00:00',
    ...overrides,
  };
}

function timeRow(id: string, time: string, amount = 1): ScheduleTimeRow {
  return {
    id,
    user_id: USER,
    medication_id: MED,
    time_of_day: time,
    dose_amount: amount,
  };
}

describe('medication rows', () => {
  it('maps a medication with every optional field to a row and back, unchanged', () => {
    const medication = makeMedication({
      id: MED,
      notes: 'Po jedzeniu',
      endDate: asLocalDate('2026-12-31'),
      dosageForm: 'tablet',
      strength: { value: 500, unit: 'mg' },
      stock: {
        quantity: 12.5,
        unit: 'tabletka',
        asOf: asTimestamp('2026-10-01T08:00:00Z'),
        basis: 'new-package',
      },
      lowStockThreshold: { quantity: 3, unit: 'tabletka' },
      scheduleTimes: [scheduleTime('t-1', '08:00', 1.5), scheduleTime('t-2', '20:30', 2)],
    });
    const row = { ...medicationToRow(medication), user_id: USER } as MedicationRow;
    const times = medication.scheduleTimes.map((time) => ({
      ...scheduleTimeToRow(MED, time),
      user_id: USER,
      time_of_day: `${time.timeOfDay}:00`,
    })) as ScheduleTimeRow[];

    expect(medicationFromRows(row, times)).toEqual(medication);
  });

  it('writes an absent optional field as NULL, and reads NULL back as absent', () => {
    const row = medicationToRow(makeMedication({ id: MED }));

    expect(row).toMatchObject({
      dosage_form: null,
      strength_value: null,
      strength_unit: null,
      low_stock_threshold: null,
      low_stock_threshold_unit: null,
      stock_quantity: null,
      stock_unit: null,
      stock_as_of: null,
      stock_basis: null,
    });
    const read = medicationFromRows(medicationRow(), []);
    expect('dosageForm' in read).toBe(false);
    expect('strength' in read).toBe(false);
    expect('lowStockThreshold' in read).toBe(false);
    expect(read.stock).toBeNull();
  });

  it('reads a time column (HH:MM:SS) as HH:mm and orders the schedule by time', () => {
    const read = medicationFromRows(medicationRow(), [
      timeRow('b0000000-0000-4000-8000-000000000001', '20:00:00'),
      timeRow('a0000000-0000-4000-8000-000000000001', '08:00:00'),
    ]);

    expect(read.scheduleTimes.map((time) => time.timeOfDay)).toEqual([
      asLocalTime('08:00'),
      asLocalTime('20:00'),
    ]);
  });

  it('reads a timestamp the database returns with an offset as the application’s own format', () => {
    const read = medicationFromRows(
      medicationRow({ created_at: '2026-01-01T09:00:00.123456+01:00' }),
      [],
    );

    expect(read.createdAt).toBe('2026-01-01T08:00:00.123Z');
  });

  it('keeps a stored zero as zero: a counted zero stock is not "no stock"', () => {
    const read = medicationFromRows(
      medicationRow({
        stock_quantity: 0,
        stock_unit: 'tabletka',
        stock_as_of: '2026-10-01T08:00:00+00:00',
      }),
      [],
    );

    expect(read.stock).toMatchObject({ quantity: 0, unit: 'tabletka' });
  });

  it('refuses a row that breaks the application’s rules instead of showing or repairing it', () => {
    const rows = [
      medicationRow({ name: '   ' }),
      medicationRow({ dosage_form: 'powder' }),
      medicationRow({ start_date: 'not a date' }),
      medicationRow({ strength_value: -1, strength_unit: 'mg' }),
      medicationRow({ end_date: '2025-12-31' }),
    ];

    for (const row of rows) {
      expect(() => medicationFromRows(row, [])).toThrow(RepositoryError);
      try {
        medicationFromRows(row, []);
      } catch (error) {
        expect((error as RepositoryError).code).toBe('data-corrupted');
      }
    }
  });
});

describe('intake record rows', () => {
  it('maps a taken dose with its amount and note both ways', () => {
    const log = makeDoseLog({
      id: MED,
      medicationId: MED,
      takenAmount: 2,
      note: 'Zgodnie z zaleceniem',
    });
    const row = { ...doseLogToRow(log), user_id: USER, scheduled_time: '08:00:00' };

    expect(doseLogFromRow(row as Parameters<typeof doseLogFromRow>[0])).toEqual(log);
  });

  it('reads NULL amount and note as absent, so an older record stays without them', () => {
    const row = { ...doseLogToRow(makeDoseLog({ id: MED, medicationId: MED })), user_id: USER };

    expect(row).toMatchObject({ taken_amount: null, note: null });
    const read = doseLogFromRow({ ...row, scheduled_time: '08:00:00' } as Parameters<
      typeof doseLogFromRow
    >[0]);
    expect('takenAmount' in read).toBe(false);
    expect('note' in read).toBe(false);
  });

  it('refuses a skipped record that carries an amount', () => {
    const row = {
      ...doseLogToRow(makeDoseLog({ id: MED, medicationId: MED })),
      user_id: USER,
      scheduled_time: '08:00:00',
      status: 'skipped',
      taken_amount: 1,
    };

    expect(() => doseLogFromRow(row as Parameters<typeof doseLogFromRow>[0])).toThrow(
      RepositoryError,
    );
  });
});

describe('appointment and stock event rows', () => {
  it('map an appointment both ways', () => {
    const appointment = makeAppointment({
      id: MED,
      specialty: 'Kardiologia',
      location: 'Przychodnia',
      notes: 'x',
    });
    const row = { ...appointmentToRow(appointment), user_id: USER };

    expect(appointmentFromRow(row as Parameters<typeof appointmentFromRow>[0])).toEqual(
      appointment,
    );
  });

  it('refuses an appointment with neither a doctor nor a specialty', () => {
    const row = {
      ...appointmentToRow(makeAppointment({ id: MED })),
      user_id: USER,
      doctor_name: null,
      specialty: null,
    };

    expect(() => appointmentFromRow(row as Parameters<typeof appointmentFromRow>[0])).toThrow(
      RepositoryError,
    );
  });

  it('map a stock event, reversed or not, both ways', () => {
    for (const event of [
      makeStockEvent({ id: MED, medicationId: MED, note: 'Nowa recepta' }),
      makeStockEvent({
        id: MED,
        medicationId: MED,
        kind: 'waste',
        reversedAt: asTimestamp('2026-10-11T08:00:00Z'),
      }),
    ]) {
      const row = { ...stockEventToRow(event), user_id: USER };

      expect(stockEventFromRow(row as Parameters<typeof stockEventFromRow>[0])).toEqual(event);
    }
  });

  it('refuses a stock event reversed before it was recorded', () => {
    const row = {
      ...stockEventToRow(makeStockEvent({ id: MED, medicationId: MED })),
      user_id: USER,
      reversed_at: '2020-01-01T00:00:00+00:00',
    };

    expect(() => stockEventFromRow(row as Parameters<typeof stockEventFromRow>[0])).toThrow(
      RepositoryError,
    );
  });
});
