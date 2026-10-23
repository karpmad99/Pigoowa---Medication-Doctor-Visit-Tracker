import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { AppointmentStateBadge } from '@/features/appointments/components/AppointmentStateBadge';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import { appointmentTitle } from '@/features/appointments/logic/appointmentForm';
import { selectDashboardAppointments } from '@/features/appointments/logic/dashboard';
import { appointmentStateLabel } from '@/features/appointments/statusLabels';
import { useServices } from '@/hooks/useServices';
import { formatLocalDate, pluralize } from '@/utils/format';
import { getLocalDateInZone, getLocalTimeInZone } from '@/utils/timeZone';
import { DashboardPanel } from './DashboardPanel';

const visitsWord = { one: 'wizyta', few: 'wizyty', many: 'wizyt' };
const MAX_SHOWN = 3;

/**
 * The next appointments (up to three), soonest first, and a note when some are waiting for
 * confirmation. It reads appointments on its own, so an error here never hides the other panels.
 * What counts as upcoming or elapsed is decided by the Stage 2 rules and the injected clock; the
 * panel only shows it and never changes an appointment.
 */
export function UpcomingAppointmentsPanel() {
  const { clock, timeZone } = useServices();
  const appointments = useAppointments();
  const selection =
    appointments.data === undefined
      ? null
      : selectDashboardAppointments(appointments.data, clock.now(), MAX_SHOWN);
  const elapsedLabel = appointmentStateLabel('needs-confirmation', 'scheduled');

  return (
    <DashboardPanel title="Najbliższe wizyty">
      {appointments.isLoading && <Spinner label="Wczytywanie wizyt…" />}

      {appointments.error !== undefined && (
        <ErrorState
          title="Nie udało się wczytać wizyt"
          message={appointments.error.message}
          onRetry={appointments.reload}
        />
      )}

      {appointments.data?.length === 0 && (
        <EmptyState
          icon="calendar"
          title="Nie dodano jeszcze żadnej wizyty"
          description="Dodaj wizytę u lekarza, a najbliższe terminy pojawią się tutaj."
          action={<ButtonLink to="/appointments/new">Dodaj pierwszą wizytę</ButtonLink>}
        />
      )}

      {selection !== null && appointments.data !== undefined && appointments.data.length > 0 && (
        <>
          {selection.needsConfirmation > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-warning-800 bg-warning-50 p-4 text-warning-800">
              <Icon name="alert" />
              <span className="min-w-0 flex-1 basis-40 font-medium">
                {`${elapsedLabel}: ${String(selection.needsConfirmation)} ${pluralize(selection.needsConfirmation, visitsWord)}. Termin minął, a nie oznaczono, czy się odbyła.`}
              </span>
              <ButtonLink to="/appointments?tab=past" variant="secondary" size="sm">
                Potwierdź
              </ButtonLink>
            </p>
          )}

          {selection.upcoming.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="Brak nadchodzących wizyt"
              description="Nie masz zaplanowanych wizyt. Dodaj nową, gdy poznasz termin."
              action={<ButtonLink to="/appointments/new">Dodaj wizytę</ButtonLink>}
            />
          ) : (
            <ul className="space-y-3">
              {selection.upcoming.map((appointment) => {
                const date = getLocalDateInZone(appointment.scheduledAt, timeZone);
                const time = getLocalTimeInZone(appointment.scheduledAt, timeZone);
                return (
                  <li
                    key={appointment.id}
                    className="rounded-card border border-line bg-canvas p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold tabular-nums">
                          {formatLocalDate(date)},{' '}
                          <time dateTime={appointment.scheduledAt}>{time}</time>
                        </p>
                        <p className="break-words text-lg font-medium">
                          {appointmentTitle(appointment)}
                        </p>
                        {appointment.doctorName !== null && appointment.specialty !== null && (
                          <p className="break-words text-base text-ink-muted">
                            {appointment.specialty}
                          </p>
                        )}
                      </div>
                      <AppointmentStateBadge phase="upcoming" status={appointment.status} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {selection.upcomingTotal > selection.upcoming.length && (
            <p className="text-base text-ink-muted">
              Pokazano {String(selection.upcoming.length)} z {String(selection.upcomingTotal)}{' '}
              nadchodzących wizyt.
            </p>
          )}
          <ButtonLink to="/appointments" variant="secondary">
            Wszystkie wizyty
          </ButtonLink>
        </>
      )}
    </DashboardPanel>
  );
}
