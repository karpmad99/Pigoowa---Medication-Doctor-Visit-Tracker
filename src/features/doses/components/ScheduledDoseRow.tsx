import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatAmount } from '@/features/medications/logic/unitForms';
import { cx } from '@/utils/cx';
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
  /**
   * Opens the dialog for the amount actually taken and the note: for a dose with no record (it is
   * then recorded as taken with that amount) and for a taken one (to edit them). Not for a
   * skipped dose, which has neither.
   */
  onDetails?: (dose: ScheduledDose) => void;
  /**
   * True for the one dose the dashboard points at (`selectNextUnrecordedDose`). Presentation only:
   * it adds a label and a stronger frame and changes nothing about the dose or its actions.
   */
  isNext?: boolean;
}

/**
 * One planned dose of the selected day: when, which medication, how much, its status, and the
 * actions that fit that status.
 * - Unrecorded: mark as taken / skipped.
 * - Recorded: change it to the other status, or clear the record.
 * - Taken with an amount other than planned: both are shown, the plan and what was taken, with the
 *   note. The message about the schedule having changed since ("obecnie w harmonogramie") keeps
 *   its own meaning and is never used for "taken differently".
 * Every button's accessible name says which dose it is for.
 * `isNext` marks the dose to deal with first. The mark is written out ("Następna dawka bez zapisu"),
 * never colour alone, and says nothing about the time: it is not "late" or "missed".
 */
export function ScheduledDoseRow({
  dose,
  pending,
  isBusy,
  canRecord,
  timeZone,
  focusRequest,
  onAction,
  onDetails,
  isNext = false,
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

  const detailsButton = (text: string, name: string) => (
    <Button
      variant="secondary"
      disabled={isBusy}
      isLoading={pending?.slotKey === slotKey && pending.target === 'details'}
      aria-label={`${name}: ${context}`}
      onClick={() => {
        onDetails?.(dose);
      }}
    >
      {text}
    </Button>
  );

  const log = dose.log;
  const recordedAmount = log === null ? null : formatAmount(log.doseAmount, log.doseUnit);
  const plannedAmount = formatAmount(dose.doseAmount, dose.doseUnit);

  return (
    <li
      className={cx(
        'rounded-card border p-4',
        isNext ? 'border-brand-700 bg-brand-50 ring-2 ring-brand-700' : 'border-line bg-canvas',
      )}
    >
      {isNext && (
        <p className="mb-2 flex items-center gap-2 text-base font-semibold text-brand-700">
          <Icon name="arrow-right" />
          Następna dawka bez zapisu
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-3xl font-bold tabular-nums">
            <time dateTime={dose.time}>{dose.time}</time>
          </p>
          <p className="break-words text-lg font-semibold">{dose.medicationName}</p>
          <p className="text-lg text-ink-muted">{plannedAmount}</p>
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
        <p className="mt-2 text-base text-ink-muted">
          {doseStatusLabel(log.status)}, zapisano {formatTimestamp(log.recordedAt, timeZone)}.
          {log.takenAmount === undefined && recordedAmount !== plannedAmount && (
            <>
              {' '}
              Zapisana dawka: {recordedAmount} (obecnie w harmonogramie: {plannedAmount}).
            </>
          )}
        </p>
      )}
      {log !== null && log.status === 'taken' && log.takenAmount !== undefined && (
        <p className="mt-2 text-base">
          <strong>Przyjęto: {formatAmount(log.takenAmount, log.doseUnit)}.</strong> Planowano wtedy:{' '}
          {recordedAmount}.
          {recordedAmount !== plannedAmount && <> Obecnie w harmonogramie: {plannedAmount}.</>}
        </p>
      )}
      {log !== null && log.status === 'taken' && log.note != null && (
        <p className="mt-2 whitespace-pre-line break-words text-base">
          <span className="font-semibold">Notatka: </span>
          {log.note}
        </p>
      )}

      {dose.status === 'unrecorded' && canRecord && (
        <div className="mt-4 grid gap-2 sm:flex">
          {button('taken', 'Oznacz jako przyjętą', 'primary')}
          {button('skipped', 'Oznacz jako pominiętą', 'secondary')}
          {onDetails !== undefined && detailsButton('Przyjęto inną ilość…', 'Przyjęto inną ilość')}
        </div>
      )}
      {dose.status === 'taken' && (
        <div className="mt-4 grid gap-2 sm:flex">
          {canRecord && button('skipped', 'Zmień na pominiętą', 'secondary')}
          {button('clear', 'Cofnij zapis', 'secondary')}
          {onDetails !== undefined &&
            detailsButton('Zmień ilość lub notatkę', 'Zmień ilość lub notatkę')}
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
