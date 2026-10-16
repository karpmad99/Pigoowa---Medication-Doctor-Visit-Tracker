import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { AppointmentPhase } from '../logic/status';
import { appointmentStateLabel } from '../statusLabels';
import type { AppointmentStatus } from '../types';

type Look = 'upcoming' | 'needs-confirmation' | 'completed' | 'cancelled';

const looks: Record<Look, { tone: BadgeTone; icon: IconName }> = {
  upcoming: { tone: 'info', icon: 'clock' },
  'needs-confirmation': { tone: 'warning', icon: 'alert' },
  completed: { tone: 'success', icon: 'check' },
  cancelled: { tone: 'neutral', icon: 'close' },
};

/**
 * Where an appointment stands, as a badge with the state in words AND its own icon (a clock, a
 * warning, a tick, a cross), so no state is told apart by colour alone.
 */
export function AppointmentStateBadge({
  phase,
  status,
}: {
  phase: AppointmentPhase;
  status: AppointmentStatus;
}) {
  const key: Look = phase === 'past' ? (status === 'cancelled' ? 'cancelled' : 'completed') : phase;
  const look = looks[key];
  return (
    <Badge tone={look.tone}>
      <Icon name={look.icon} className="mr-1 size-3.5" />
      {appointmentStateLabel(phase, status)}
    </Badge>
  );
}
