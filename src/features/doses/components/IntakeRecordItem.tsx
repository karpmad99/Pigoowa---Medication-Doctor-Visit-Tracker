import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { formatAmount } from '@/features/medications/logic/unitForms';
import type { Medication } from '@/features/medications/types';
import { formatLocalDay, formatTimestamp } from '@/utils/format';
import type { OutsideScheduleReason } from '../logic/history';
import { outsideScheduleExplanation } from '../outsideScheduleText';
import type { DoseLog } from '../types';
import { DoseStatusBadge } from './DoseStatusBadge';

interface IntakeRecordItemProps {
  log: DoseLog;
  /** `null` for a medication that no longer exists. */
  medication: Medication | undefined;
  /** `null` when the record matches the current schedule. */
  outsideReason: OutsideScheduleReason | null;
  timeZone: string;
  /** Show the day too (the history groups by day and shows it in a heading instead). */
  showDate?: boolean;
  /** Buttons for this record, shown at the bottom (the history offers deletion of outside-schedule records). */
  actions?: ReactNode;
}

/**
 * One intake record, as it was stored: the slot it belongs to, its status, and the amount and
 * unit recorded at that moment (never the medication's current dose). A record outside the
 * current schedule is labelled and explained; it is never hidden or altered.
 */
export function IntakeRecordItem({
  log,
  medication,
  outsideReason,
  timeZone,
  showDate = false,
  actions,
}: IntakeRecordItemProps) {
  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold tabular-nums">
            {showDate && <>{formatLocalDay(log.scheduledDate)}, </>}
            <time dateTime={log.scheduledTime}>{log.scheduledTime}</time>
          </p>
          <p className="break-words font-medium">{medication?.name ?? 'Usunięty lek'}</p>
          {log.status === 'taken' && log.takenAmount !== undefined ? (
            <>
              <p className="font-medium">Przyjęto: {formatAmount(log.takenAmount, log.doseUnit)}</p>
              <p className="text-ink-muted">
                Planowano: {formatAmount(log.doseAmount, log.doseUnit)}
              </p>
            </>
          ) : (
            <p className="text-ink-muted">
              Zapisana dawka: {formatAmount(log.doseAmount, log.doseUnit)}
            </p>
          )}
        </div>
        <DoseStatusBadge status={log.status} />
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Zapisano {formatTimestamp(log.recordedAt, timeZone)}.
      </p>
      {log.status === 'taken' && log.note != null && (
        <p className="mt-2 whitespace-pre-line break-words text-base">
          <span className="font-semibold">Notatka: </span>
          {log.note}
        </p>
      )}
      {outsideReason !== null && (
        <div className="mt-3 space-y-1">
          <Badge tone="info">Poza aktualnym harmonogramem</Badge>
          <p className="text-sm text-ink-muted">
            {outsideScheduleExplanation(outsideReason, medication)}
          </p>
        </div>
      )}
      {actions !== undefined && <div className="mt-4 grid gap-2 sm:flex">{actions}</div>}
    </li>
  );
}
