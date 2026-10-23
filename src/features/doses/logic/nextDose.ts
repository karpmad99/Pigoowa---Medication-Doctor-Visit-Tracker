import type { ScheduledDose } from '../types';
import { compareDoses } from './scheduledDoses';

/**
 * The dose to point at on the dashboard: the first dose of the day, in schedule order, that has no
 * record (PROJECT_SPEC DEC-50). Nothing else decides it.
 *
 * It is a presentation choice, not a rule about the person. It takes no clock, so it can never
 * mean "late" or "missed": at 18:00 an unrecorded 08:00 dose is still the first one without a
 * record. It does not depend on the order of `doses` (it uses the order the day view uses), and
 * once that dose is recorded the next one without a record is the answer. When every dose has a
 * record, or there are none, it is `null` and nothing is highlighted.
 */
export function selectNextUnrecordedDose(doses: readonly ScheduledDose[]): ScheduledDose | null {
  let first: ScheduledDose | null = null;
  for (const dose of doses) {
    if (dose.status !== 'unrecorded') continue;
    if (first === null || compareDoses(dose, first) < 0) first = dose;
  }
  return first;
}
