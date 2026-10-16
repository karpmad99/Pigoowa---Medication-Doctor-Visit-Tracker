import type { Appointment } from '@/features/appointments/types';
import type { DoseLog } from '@/features/doses/types';
import type { Medication } from '@/features/medications/types';
import type { Id, LocalDate, LocalTime, Timestamp } from '@/types/primitives';
import { addDays, asLocalTime } from '@/utils/date';
import { getLocalDateInZone, localDateTimeToTimestamp } from '@/utils/timeZone';

// FICTIONAL demo data for developing and demonstrating Pigoowa. Every name, dose, doctor and
// address below is invented; nothing here describes a real person, product or treatment. It is
// kept apart from the repositories on purpose: it is plain data produced by a pure function.
//
// Dates are relative to "today" (so "upcoming" appointments stay upcoming), but the result is
// fully determined by the two inputs, so a fixed clock gives identical data every time.

/** All demo entities have ids starting with this, so the UI can mark them as sample data. */
export const DEMO_ID_PREFIX = 'demo-';

export function isDemoId(id: Id): boolean {
  return id.startsWith(DEMO_ID_PREFIX);
}

export interface DemoData {
  medications: Medication[];
  doseLogs: DoseLog[];
  appointments: Appointment[];
}

export interface DemoDataInput {
  /** The moment the demo data is created at. */
  now: Timestamp;
  /** IANA time zone deciding what "today" is and what local times mean. */
  timeZone: string;
}

export function createDemoData({ now, timeZone }: DemoDataInput): DemoData {
  const today = getLocalDateInZone(now, timeZone);
  const day = (offset: number): LocalDate => addDays(today, offset);
  const time = (value: string): LocalTime => asLocalTime(value);
  const at = (date: LocalDate, localTime: string): Timestamp => {
    const result = localDateTimeToTimestamp(date, time(localTime), timeZone);
    // The times used below (never between 02:00 and 03:00) exist in every time zone on every day.
    if (!result.ok) throw new Error('Demo data used a local time that does not exist');
    return result.timestamp;
  };

  const medications: Medication[] = [
    {
      id: 'demo-medication-demoxal',
      name: 'Demoxal',
      doseUnit: 'tabletka',
      notes: 'Przykładowy lek. Dane fikcyjne.',
      startDate: day(-60),
      endDate: null,
      // The schedule was changed 10 days ago: older records belong to the previous schedule.
      scheduleEffectiveFrom: day(-10),
      scheduleTimes: [
        { id: 'demo-schedule-demoxal-morning', timeOfDay: time('08:00'), doseAmount: 1 },
        { id: 'demo-schedule-demoxal-evening', timeOfDay: time('20:00'), doseAmount: 1 },
      ],
      stock: { quantity: 28, unit: 'tabletka', asOf: now },
      createdAt: at(day(-60), '09:00'),
      updatedAt: at(day(-10), '09:00'),
    },
    {
      id: 'demo-medication-przykladyna',
      name: 'Przykładyna',
      doseUnit: 'ml',
      notes: 'Syrop. Dane fikcyjne.',
      startDate: day(-30),
      endDate: null,
      scheduleEffectiveFrom: day(-30),
      scheduleTimes: [
        { id: 'demo-schedule-przykladyna-morning', timeOfDay: time('07:30'), doseAmount: 5 },
      ],
      stock: { quantity: 120, unit: 'ml', asOf: now },
      createdAt: at(day(-30), '09:00'),
      updatedAt: at(day(-30), '09:00'),
    },
    {
      // No stock entered: its stock estimate is "unavailable".
      id: 'demo-medication-testovit',
      name: 'Testovit',
      doseUnit: 'kapsułka',
      notes: null,
      startDate: day(-20),
      endDate: null,
      scheduleEffectiveFrom: day(-20),
      scheduleTimes: [
        { id: 'demo-schedule-testovit-noon', timeOfDay: time('13:00'), doseAmount: 1 },
      ],
      stock: null,
      createdAt: at(day(-20), '09:00'),
      updatedAt: at(day(-20), '09:00'),
    },
    {
      // Already ended: shows that stopping a medication keeps its history.
      id: 'demo-medication-dawnoxin',
      name: 'Dawnoxin',
      doseUnit: 'tabletka',
      notes: 'Zakończona kuracja. Dane fikcyjne.',
      startDate: day(-45),
      endDate: day(-10),
      scheduleEffectiveFrom: day(-45),
      scheduleTimes: [
        { id: 'demo-schedule-dawnoxin-morning', timeOfDay: time('09:00'), doseAmount: 2 },
      ],
      stock: null,
      createdAt: at(day(-45), '09:00'),
      updatedAt: at(day(-10), '09:00'),
    },
  ];

  const log = (
    medicationId: Id,
    offset: number,
    localTime: string,
    status: DoseLog['status'],
    doseAmount: number,
    doseUnit: string,
  ): DoseLog => {
    const date = day(offset);
    return {
      id: `demo-dose-${medicationId.slice('demo-medication-'.length)}-${date}-${localTime.replace(':', '')}`,
      medicationId,
      scheduledDate: date,
      scheduledTime: time(localTime),
      status,
      doseAmount,
      doseUnit,
      recordedAt: at(date, localTime),
    };
  };

  const doseLogs: DoseLog[] = [
    // Demoxal: three recent days, one skipped dose.
    log('demo-medication-demoxal', -3, '08:00', 'taken', 1, 'tabletka'),
    log('demo-medication-demoxal', -3, '20:00', 'taken', 1, 'tabletka'),
    log('demo-medication-demoxal', -2, '08:00', 'taken', 1, 'tabletka'),
    log('demo-medication-demoxal', -2, '20:00', 'skipped', 1, 'tabletka'),
    log('demo-medication-demoxal', -1, '08:00', 'taken', 1, 'tabletka'),
    log('demo-medication-demoxal', -1, '20:00', 'taken', 1, 'tabletka'),
    // Recorded under the previous schedule, before `scheduleEffectiveFrom`: stays as history.
    log('demo-medication-demoxal', -12, '08:00', 'taken', 1, 'tabletka'),
    log('demo-medication-przykladyna', -3, '07:30', 'taken', 5, 'ml'),
    log('demo-medication-przykladyna', -2, '07:30', 'taken', 5, 'ml'),
    log('demo-medication-przykladyna', -1, '07:30', 'taken', 5, 'ml'),
    // History of the ended medication.
    log('demo-medication-dawnoxin', -12, '09:00', 'taken', 2, 'tabletka'),
    log('demo-medication-dawnoxin', -11, '09:00', 'taken', 2, 'tabletka'),
  ];

  const appointments: Appointment[] = [
    {
      id: 'demo-appointment-upcoming-cardiology',
      doctorName: 'dr Anna Przykładowska',
      specialty: 'Kardiolog',
      scheduledAt: at(day(3), '09:30'),
      location: 'Przychodnia Przykładowa, ul. Demonstracyjna 1',
      notes: null,
      status: 'scheduled',
      createdAt: at(day(-20), '12:00'),
      updatedAt: at(day(-20), '12:00'),
    },
    {
      id: 'demo-appointment-upcoming-eyes',
      doctorName: null,
      specialty: 'Okulista',
      scheduledAt: at(day(12), '14:15'),
      location: 'Centrum Medyczne Testowe',
      notes: 'Zabrać dotychczasowe okulary. Dane fikcyjne.',
      status: 'scheduled',
      createdAt: at(day(-4), '10:00'),
      updatedAt: at(day(-4), '10:00'),
    },
    {
      id: 'demo-appointment-completed',
      doctorName: 'dr Jan Testowy',
      specialty: 'Internista',
      scheduledAt: at(day(-14), '10:00'),
      location: 'Przychodnia Przykładowa, ul. Demonstracyjna 1',
      notes: null,
      status: 'completed',
      createdAt: at(day(-30), '12:00'),
      updatedAt: at(day(-14), '11:00'),
    },
    {
      id: 'demo-appointment-cancelled',
      doctorName: null,
      specialty: 'Dermatolog',
      scheduledAt: at(day(-5), '16:30'),
      location: null,
      notes: null,
      status: 'cancelled',
      createdAt: at(day(-25), '12:00'),
      updatedAt: at(day(-6), '08:00'),
    },
    {
      // Its time has passed but nobody marked it: it "needs confirmation".
      id: 'demo-appointment-needs-confirmation',
      doctorName: 'dr Ewa Demonstracyjna',
      specialty: 'Neurolog',
      scheduledAt: at(day(-1), '11:00'),
      location: 'Gabinet Przykładowy',
      notes: null,
      status: 'scheduled',
      createdAt: at(day(-15), '12:00'),
      updatedAt: at(day(-15), '12:00'),
    },
  ];

  return { medications, doseLogs, appointments };
}
