import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { formatAmount } from '@/features/medications/logic/unitForms';
import { formatTimestamp } from '@/utils/format';
import type { DoseTarget } from '../applyDoseAction';
import type { PendingDoseAction } from '../hooks/useDoseActions';
import { doseSlotKey } from '../logic/slots';
import type { ScheduledDose } from '../types';
import { doseStatusLabel } from '../statusLabels';
import { DoseStatusBadge } from './DoseStatusBadge';

/** Asks the row of one slot to take keyboard focus (after its action finished). */
export interface FocusRequest {
  slotKey: string;
  /** Changes with every request, so asking twice for the same row works. */
  sequence: number;
}

interface ScheduledDoseRowProps {
  dose: ScheduledDose;
  /** The write in flight, if any: its button shows progress. */
  pending: PendingDoseAction | null;
  /**
   * True while a write runs AND while the list refreshes after it. Every row's buttons are
   * disabled then, so a click cannot land on a row that is about to change.
   */
  isBusy: boolean;
  /** False for a day after today: such a dose cannot be recorded (PROJECT_SPEC D-6). */
  canRecord: boolean;
  timeZone: string;
  focusRequest: FocusRequest | null;
  onAction: (dose: ScheduledDose, target: DoseTarget) => void;
}

/**
 * One planned dose of the selected day: when, which medication, how much, its status, and the
 * actions that fit that status.
 * - Unrecorded: mark as taken / skipped.
 * - Recorded: change it to the other status, or clear the record.
 * Every button's accessible name says which dose it is for.
 */
export function ScheduledDoseRow({
  dose,
  pending,
  isBusy,
  canRecord,
  timeZone,
  focusRequest,
  onAction,
}: ScheduledDoseRowProps) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const slotKey = doseSlotKey(dose);

  // After an action the buttons that were pressed have changed or disappeared, so focus goes to
  // the status of this row, which screen readers read out together with the dose it belongs to.
  useEffect(() => {
    if (focusRequest?.slotKey === slotKey) statusRef.current?.focus();
  }, [focusRequest, slotKey]);

  const context = `${dose.medicationName}, ${dose.time}`;
  const isPending = (target: DoseTarget) =>
    pending?.slotKey === slotKey && pending.target === target;
  const button = (target: DoseTarget, text: string, variant: 'primary' | 'secondary') => (
    <Button
      variant={variant}
      isLoading={isPending(target)}
      disabled={isBusy}
      aria-label={`${text}: ${context}`}
      onClick={() => {
        onAction(dose, target);
      }}
    >
      {text}
    </Button>
  );

  const log = dose.log;
  const recordedAmount = log === null ? null : formatAmount(log.doseAmount, log.doseUnit);
  const plannedAmount = formatAmount(dose.doseAmount, dose.doseUnit);

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xl font-semibold tabular-nums">
            <time dateTime={dose.time}>{dose.time}</time>
          </p>
          <p className="break-words font-medium">{dose.medicationName}</p>
          <p className="text-ink-muted">{plannedAmount}</p>
        </div>
        <p
          ref={statusRef}
          tabIndex={-1}
          className="rounded-control focus:outline-2 focus:outline-offset-2 focus:outline-brand-600"
        >
          <span className="sr-only">{context}: </span>
          <DoseStatusBadge status={dose.status} isFuture={!canRecord} />
        </p>
      </div>

      {log !== null && (
        <p className="mt-2 text-sm text-ink-muted">
          {doseStatusLabel(log.status)}, zapisano {formatTimestamp(log.recordedAt, timeZone)}.
          {recordedAmount !== plannedAmount && (
            <>
              {' '}
              Zapisana dawka: {recordedAmount} (obecnie w harmonogramie: {plannedAmount}).
            </>
          )}
        </p>
      )}

      {dose.status === 'unrecorded' && canRecord && (
        <div className="mt-4 grid gap-2 sm:flex">
          {button('taken', 'Oznacz jako przyjętą', 'primary')}
          {button('skipped', 'Oznacz jako pominiętą', 'secondary')}
        </div>
      )}
      {dose.status === 'taken' && (
        <div className="mt-4 grid gap-2 sm:flex">
          {canRecord && button('skipped', 'Zmień na pominiętą', 'secondary')}
          {button('clear', 'Cofnij zapis', 'secondary')}
        </div>
      )}
      {dose.status === 'skipped' && (
        <div className="mt-4 grid gap-2 sm:flex">
          {canRecord && button('taken', 'Zmień na przyjętą', 'secondary')}
          {button('clear', 'Cofnij zapis', 'secondary')}
        </div>
      )}
    </li>
  );
}
