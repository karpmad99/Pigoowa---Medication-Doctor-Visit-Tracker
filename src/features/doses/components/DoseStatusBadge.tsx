import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { doseStatusLabel } from '../statusLabels';
import type { DoseStatus } from '../types';

/**
 * The status of a dose as a badge. The status is always written out, and each one has its own
 * icon (a tick, a dash, a clock), so no status is told apart by colour alone. "Nie zapisano"
 * means only that nothing was recorded: it is not "skipped" and not "missed".
 * `isFuture` relabels an unrecorded dose of a day that has not come yet as "Zaplanowana".
 */
export function DoseStatusBadge({
  status,
  isFuture = false,
}: {
  status: DoseStatus;
  isFuture?: boolean;
}) {
  if (status === 'taken') {
    return (
      <Badge tone="success">
        <Icon name="check" className="mr-1 size-3.5" />
        {doseStatusLabel('taken')}
      </Badge>
    );
  }
  if (status === 'skipped') {
    return (
      <Badge tone="warning">
        <Icon name="minus" className="mr-1 size-3.5" />
        {doseStatusLabel('skipped')}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <Icon name="clock" className="mr-1 size-3.5" />
      {isFuture ? 'Zaplanowana' : doseStatusLabel('unrecorded')}
    </Badge>
  );
}
