import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { formatLocalDay } from '@/utils/format';
import { getLocalDateInZone, getLocalTimeInZone } from '@/utils/timeZone';
import { appointmentStatusElementId } from '../elementIds';
import { appointmentTitle } from '../logic/appointmentForm';
import type { AppointmentPhase } from '../logic/status';
import type { Appointment, AppointmentStatus } from '../types';
import { AppointmentStateBadge } from './AppointmentStateBadge';

/** The write in flight: which appointment, and which status was asked for. */
export interface PendingStatusChange {
  id: string;
  status: AppointmentStatus;
}

interface AppointmentCardProps {
  appointment: Appointment;
  phase: AppointmentPhase;
  timeZone: string;
  /** The status change in flight, if any: its button shows progress. */
  pending: PendingStatusChange | null;
  /** True while any write runs and while the list refreshes after it: every action is disabled. */
  isBusy: boolean;
  onStatus: (appointment: Appointment, status: AppointmentStatus) => void;
  onDelete: (appointment: Appointment) => void;
}

/**
 * One appointment: time, who, where, notes, and where it stands (in words and with an icon).
 * The actions fit the state:
 * - upcoming or needing confirmation: mark it completed or cancelled (a missed one is never
 *   decided automatically: A-7);
 * - completed or cancelled: restore it as scheduled (a correction);
 * - always: edit, and delete permanently (a separate, clearly marked action).
 * Every action's accessible name says which appointment it is for.
 */
export function AppointmentCard({
  appointment,
  phase,
  timeZone,
  pending,
  isBusy,
  onStatus,
  onDelete,
}: AppointmentCardProps) {
  const title = appointmentTitle(appointment);
  const showsBoth = appointment.doctorName !== null && appointment.specialty !== null;
  const date = getLocalDateInZone(appointment.scheduledAt, timeZone);
  const time = getLocalTimeInZone(appointment.scheduledAt, timeZone);
  const context = `${title}, ${formatLocalDay(date)}, ${time}`;
  const isPending = (status: AppointmentStatus) =>
    pending?.id === appointment.id && pending.status === status;

  const statusButton = (
    status: AppointmentStatus,
    text: string,
    variant: 'primary' | 'secondary',
  ) => (
    <Button
      variant={variant}
      isLoading={isPending(status)}
      disabled={isBusy}
      aria-label={`${text}: ${context}`}
      onClick={() => {
        onStatus(appointment, status);
      }}
    >
      {text}
    </Button>
  );

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xl font-semibold tabular-nums">
            <time dateTime={appointment.scheduledAt}>{time}</time>
          </p>
          <p className="break-words font-medium">{title}</p>
          {showsBoth && <p className="break-words text-ink-muted">{appointment.specialty}</p>}
        </div>
        <p
          id={appointmentStatusElementId(appointment.id)}
          tabIndex={-1}
          className="rounded-control focus:outline-2 focus:outline-offset-2 focus:outline-brand-600"
        >
          <span className="sr-only">{context}: </span>
          <AppointmentStateBadge phase={phase} status={appointment.status} />
        </p>
      </div>

      {(appointment.location !== null || appointment.notes !== null) && (
        <dl className="mt-3 space-y-1 text-sm">
          {appointment.location !== null && (
            <div>
              <dt className="inline font-semibold">Miejsce: </dt>
              <dd className="inline break-words text-ink-muted">{appointment.location}</dd>
            </div>
          )}
          {appointment.notes !== null && (
            <div>
              <dt className="inline font-semibold">Notatki: </dt>
              <dd className="inline whitespace-pre-line break-words text-ink-muted">
                {appointment.notes}
              </dd>
            </div>
          )}
        </dl>
      )}

      {phase === 'needs-confirmation' && (
        <p className="mt-3 text-sm text-warning-800">
          Termin tej wizyty minął. Oznacz, czy się odbyła, czy została odwołana. Aplikacja nie
          zmienia tego sama.
        </p>
      )}

      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
        {phase !== 'past' && (
          <>
            {statusButton(
              'completed',
              'Oznacz jako odbytą',
              phase === 'needs-confirmation' ? 'primary' : 'secondary',
            )}
            {statusButton('cancelled', 'Oznacz jako odwołaną', 'secondary')}
          </>
        )}
        {phase === 'past' && statusButton('scheduled', 'Przywróć jako zaplanowaną', 'secondary')}
        <ButtonLink
          to={`/appointments/${encodeURIComponent(appointment.id)}/edit`}
          variant="secondary"
          aria-label={`Edytuj wizytę: ${context}`}
        >
          Edytuj
        </ButtonLink>
        <Button
          variant="dangerOutline"
          disabled={isBusy}
          aria-label={`Usuń trwale…: ${context}`}
          onClick={() => {
            onDelete(appointment);
          }}
        >
          <Icon name="alert" className="size-4" />
          Usuń trwale…
        </Button>
      </div>
    </li>
  );
}
