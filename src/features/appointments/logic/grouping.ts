import type { LocalDate } from '@/types/primitives';
import { getLocalDateInZone } from '@/utils/timeZone';
import type { Appointment } from '../types';

export interface AppointmentDay {
  date: LocalDate;
  appointments: Appointment[];
}

/**
 * Splits an already ordered list into consecutive days, keeping the order. A day is the calendar
 * date on the wall clock in `timeZone`, so a visit at 00:30 belongs to the new day and one at
 * 23:30 to the old one, however UTC dates the same instants.
 */
export function groupAppointmentsByDate(
  ordered: readonly Appointment[],
  timeZone: string,
): AppointmentDay[] {
  const days: AppointmentDay[] = [];
  for (const appointment of ordered) {
    const date = getLocalDateInZone(appointment.scheduledAt, timeZone);
    const last = days.at(-1);
    if (last?.date === date) last.appointments.push(appointment);
    else days.push({ date, appointments: [appointment] });
  }
  return days;
}
