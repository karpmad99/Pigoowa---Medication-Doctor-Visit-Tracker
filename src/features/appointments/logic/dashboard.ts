import type { Timestamp } from '@/types/primitives';
import type { Appointment } from '../types';
import { classifyAppointment, splitAppointments } from './status';

export interface DashboardAppointments {
  /** The next upcoming appointments, soonest first, at most `limit`. */
  upcoming: Appointment[];
  /** How many upcoming appointments there are in all (so the panel can say there are more). */
  upcomingTotal: number;
  /** Scheduled appointments whose time has passed and that nobody has marked yet. */
  needsConfirmation: number;
}

/**
 * What the dashboard shows about appointments, built only from the Stage 2 rules
 * (`splitAppointments`, `classifyAppointment`): the next few upcoming ones, and how many still wait
 * for confirmation. Nothing is changed: an elapsed appointment is only counted.
 */
export function selectDashboardAppointments(
  appointments: readonly Appointment[],
  now: Timestamp,
  limit = 3,
): DashboardAppointments {
  const { upcoming, past } = splitAppointments(appointments, now);
  return {
    upcoming: upcoming.slice(0, limit),
    upcomingTotal: upcoming.length,
    needsConfirmation: past.filter(
      (appointment) => classifyAppointment(appointment, now) === 'needs-confirmation',
    ).length,
  };
}
