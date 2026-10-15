import type { Appointment } from '@/features/appointments/types';
import type { DoseLog } from '@/features/doses/types';
import type { Medication, ScheduleTime } from '@/features/medications/types';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';

// Small builders so each test states only what matters to it. Every default is explicit and
// fixed: nothing here reads the real clock.

export function scheduleTime(id: string, time: string, doseAmount = 1): ScheduleTime {
  return { id, timeOfDay: asLocalTime(time), doseAmount };
}

export function makeMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: 'Lek A',
    doseUnit: 'tabletka',
    notes: null,
    startDate: asLocalDate('2026-01-01'),
    endDate: null,
    scheduleEffectiveFrom: asLocalDate('2026-01-01'),
    scheduleTimes: [scheduleTime('t-1', '08:00')],
    stock: null,
    createdAt: asTimestamp('2026-01-01T08:00:00Z'),
    updatedAt: asTimestamp('2026-01-01T08:00:00Z'),
    ...overrides,
  };
}

export function makeDoseLog(overrides: Partial<DoseLog> = {}): DoseLog {
  return {
    id: 'log-1',
    medicationId: 'med-1',
    scheduledDate: asLocalDate('2026-10-15'),
    scheduledTime: asLocalTime('08:00'),
    status: 'taken',
    doseAmount: 1,
    doseUnit: 'tabletka',
    recordedAt: asTimestamp('2026-10-15T06:05:00Z'),
    ...overrides,
  };
}

export function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    doctorName: 'dr Nowak',
    specialty: null,
    scheduledAt: asTimestamp('2026-10-20T08:00:00Z'),
    location: null,
    notes: null,
    status: 'scheduled',
    createdAt: asTimestamp('2026-10-01T08:00:00Z'),
    updatedAt: asTimestamp('2026-10-01T08:00:00Z'),
    ...overrides,
  };
}

/** Narrows a `{ ok: boolean }` result to its success branch, failing the test with a clear message otherwise. */
export function assertOk<T extends { ok: boolean }>(
  result: T,
): asserts result is Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`Expected a successful result, got: ${JSON.stringify(result)}`);
  }
}
