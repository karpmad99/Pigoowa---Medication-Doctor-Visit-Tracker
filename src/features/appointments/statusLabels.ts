import type { AppointmentPhase } from './logic/status';
import type { AppointmentStatus } from './types';

/**
 * The Polish word for where an appointment stands. It always names the state, so nothing is told
 * by colour alone. "Do potwierdzenia" means the time has passed and nobody has said what
 * happened: the app never decides that itself.
 */
export function appointmentStateLabel(phase: AppointmentPhase, status: AppointmentStatus): string {
  if (phase === 'upcoming') return 'Zaplanowana';
  if (phase === 'needs-confirmation') return 'Do potwierdzenia';
  return status === 'cancelled' ? 'Odwołana' : 'Odbyła się';
}
