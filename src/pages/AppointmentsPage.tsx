import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { readFlashNotice } from '@/app/flashNotice';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { tabId, tabPanelId } from '@/components/ui/tabIds';
import {
  applyAppointmentStatusChange,
  statusChangeRefusalMessages,
} from '@/features/appointments/appointmentActions';
import {
  AppointmentCard,
  type PendingStatusChange,
} from '@/features/appointments/components/AppointmentCard';
import { appointmentStatusElementId } from '@/features/appointments/elementIds';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import { appointmentTitle } from '@/features/appointments/logic/appointmentForm';
import { groupAppointmentsByDate } from '@/features/appointments/logic/grouping';
import { classifyAppointment, splitAppointments } from '@/features/appointments/logic/status';
import { appointmentStateLabel } from '@/features/appointments/statusLabels';
import type { Appointment, AppointmentStatus } from '@/features/appointments/types';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { formatLocalDate, formatLocalDay, pluralize } from '@/utils/format';
import { getLocalDateInZone, getLocalTimeInZone } from '@/utils/timeZone';

type TabName = 'upcoming' | 'past';

const TABS_PREFIX = 'appointments';
const visitsWord = { one: 'wizytę', few: 'wizyty', many: 'wizyt' };

/** "dr Nowak, 20 października 2026, 10:00": how a notice or dialog names one appointment. */
function describe(appointment: Appointment, timeZone: string): string {
  const date = getLocalDateInZone(appointment.scheduledAt, timeZone);
  const time = getLocalTimeInZone(appointment.scheduledAt, timeZone);
  return `${appointmentTitle(appointment)}, ${formatLocalDay(date)}, ${time}`;
}

/**
 * The appointments: Upcoming and Past tabs (in the address, `?tab=past`), each grouped by day.
 * Where an appointment belongs comes from the Stage 2 rules (`classifyAppointment`) applied to the
 * injected clock and the user's time zone. An appointment whose time has passed but that nobody
 * marked is "Do potwierdzenia": it is never changed automatically.
 */
export function AppointmentsPage() {
  usePageTitle('Wizyty');
  const { clock, timeZone, repositories } = useServices();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabName = searchParams.get('tab') === 'past' ? 'past' : 'upcoming';

  const appointments = useAppointments({ keepDataOnReload: true });
  const action = useAsyncAction();

  const [notice, setNotice] = useState<string | null>(() => readFlashNotice(location.state));
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const [pending, setPending] = useState<PendingStatusChange | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Appointment | null>(null);

  // The message from the previous page was kept in `notice`; remove it from the history entry so
  // that reloading the page does not show it again.
  useEffect(() => {
    if (location.state !== null) {
      void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  // After a write the button that was pressed has changed or is gone (the appointment may have
  // moved to the other tab), so focus goes to that appointment's status, or else to the list
  // heading. It waits for the refresh that follows the write: the list is replaced when the new
  // data arrives, and focus must not be left on something that is about to disappear.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusWanted = useRef<string | null | undefined>(undefined);
  const [focusRequest, setFocusRequest] = useState(0);
  const isRefreshing = appointments.isRefreshing;
  useEffect(() => {
    if (focusWanted.current === undefined || isRefreshing) return;
    const wantedId = focusWanted.current;
    focusWanted.current = undefined;
    const status =
      wantedId === null ? null : document.getElementById(appointmentStatusElementId(wantedId));
    (status ?? headingRef.current ?? document.getElementById('main-content'))?.focus();
  }, [focusRequest, isRefreshing]);
  const requestFocus = (id: string | null) => {
    focusWanted.current = id;
    setFocusRequest((previous) => previous + 1);
  };

  const now = clock.now();
  const split = useMemo(
    () => (appointments.data === undefined ? null : splitAppointments(appointments.data, now)),
    [appointments.data, now],
  );
  const needsConfirmation =
    split?.past.filter(
      (appointment) => classifyAppointment(appointment, now) === 'needs-confirmation',
    ).length ?? 0;

  const selectTab = (next: string) => {
    setSearchParams(next === 'past' ? { tab: 'past' } : {}, { replace: true });
  };

  const isBusy = action.isRunning || isRefreshing;

  const changeStatus = async (appointment: Appointment, status: AppointmentStatus) => {
    // The state is set inside the guarded task: a click that is ignored because a write is
    // already running must not clear that write's notices or switch off its progress indicator.
    const outcome = await action.run(() => {
      setNotice(null);
      setProblem(null);
      setPending({ id: appointment.id, status });
      return applyAppointmentStatusChange({
        repositories,
        id: appointment.id,
        status,
        now: clock.now(),
      });
    });
    if (outcome.status === 'ignored') return;
    setPending(null);

    if (outcome.status === 'failed') {
      if (outcome.error.code === 'not-found') {
        setProblem({
          title: 'Nie znaleziono wizyty',
          message:
            'Ta wizyta została już usunięta (być może w innej karcie). Widok został odświeżony.',
        });
        appointments.reload();
        requestFocus(null);
      } else {
        setProblem({ title: 'Nie zmieniono statusu', message: outcome.error.message });
        requestFocus(appointment.id);
      }
      return;
    }

    const result = outcome.value;
    if (!result.ok) {
      setProblem({
        title: 'Nie zmieniono statusu',
        message: statusChangeRefusalMessages[result.error],
      });
    } else if (result.change === 'unchanged') {
      setNotice(
        `Ta wizyta miała już taki status: ${describe(result.appointment, timeZone)}. Nic nie zmieniono.`,
      );
    } else {
      const phase = classifyAppointment(result.appointment, clock.now());
      const label = appointmentStateLabel(phase, result.appointment.status).toLowerCase();
      const what =
        status === 'completed'
          ? 'Oznaczono jako odbytą'
          : status === 'cancelled'
            ? 'Oznaczono jako odwołaną'
            : 'Przywrócono jako zaplanowaną';
      setNotice(
        `${what}: ${describe(result.appointment, timeZone)}.` +
          (status === 'scheduled' && phase === 'needs-confirmation'
            ? ` Jej termin już minął, więc ma status „${label}” na liście Minione.`
            : ''),
      );
    }
    appointments.reload();
    requestFocus(appointment.id);
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
    action.clearError();
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    const outcome = await action.run(() => repositories.appointments.remove(target.id));
    if (outcome.status === 'ignored') return;
    if (outcome.status === 'failed' && outcome.error.code !== 'not-found') return; // stays in the dialog

    setProblem(null);
    setNotice(
      outcome.status === 'success'
        ? `Usunięto wizytę: ${describe(target, timeZone)}.`
        : `Ta wizyta była już usunięta: ${describe(target, timeZone)}.`,
    );
    closeDeleteDialog();
    appointments.reload();
    requestFocus(null);
  };

  const list = split === null ? [] : tab === 'upcoming' ? split.upcoming : split.past;
  const days = groupAppointmentsByDate(list, timeZone);
  const tabs = [
    { id: 'upcoming', label: `Nadchodzące (${String(split?.upcoming.length ?? 0)})` },
    { id: 'past', label: `Minione (${String(split?.past.length ?? 0)})` },
  ];
  const addButton = <ButtonLink to="/appointments/new">Dodaj wizytę</ButtonLink>;

  return (
    <>
      <PageHeader
        title="Wizyty"
        description="Nadchodzące i minione wizyty u lekarzy. Zapisujesz tylko termin i swoje notatki; aplikacja nie ocenia, czy wizyta jest potrzebna."
        actions={addButton}
      />

      <div role="status" aria-live="polite">
        {notice !== null && (
          <p className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card border border-success-800 bg-success-50 p-4 text-success-800">
            <Icon name="check" className="mt-0.5" />
            <span className="min-w-0 flex-1 basis-48 font-medium">{notice}</span>
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 text-success-800"
              onClick={() => {
                setNotice(null);
              }}
            >
              Zamknij komunikat
            </Button>
          </p>
        )}
      </div>
      {problem !== null && (
        <div className="mb-4">
          <ErrorState title={problem.title} message={problem.message} />
        </div>
      )}

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
          description="Dodaj pierwszą wizytę, aby zobaczyć tu terminy. Dane są zapisywane tylko w tej przeglądarce."
          action={<ButtonLink to="/appointments/new">Dodaj pierwszą wizytę</ButtonLink>}
        />
      )}

      {split !== null && appointments.data !== undefined && appointments.data.length > 0 && (
        <div className="space-y-5">
          <Tabs
            label="Wizyty"
            tabs={tabs}
            selectedId={tab}
            onSelect={selectTab}
            idPrefix={TABS_PREFIX}
          />

          <div
            role="tabpanel"
            id={tabPanelId(TABS_PREFIX, tab)}
            aria-labelledby={tabId(TABS_PREFIX, tab)}
            className="space-y-5"
          >
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="rounded-control text-lg font-semibold focus:outline-2 focus:outline-offset-2 focus:outline-brand-600"
            >
              {tab === 'upcoming' ? 'Nadchodzące wizyty' : 'Minione wizyty'}
            </h2>

            {tab === 'upcoming' && needsConfirmation > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-warning-800 bg-warning-50 p-4 text-warning-800">
                <Icon name="alert" />
                <span className="min-w-0 flex-1 basis-48 font-medium">
                  {`Masz ${String(needsConfirmation)} ${pluralize(needsConfirmation, visitsWord)} do potwierdzenia na liście minionych.`}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    selectTab('past');
                  }}
                >
                  Zobacz minione wizyty
                </Button>
              </p>
            )}

            {list.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={tab === 'upcoming' ? 'Brak nadchodzących wizyt' : 'Brak minionych wizyt'}
                description={
                  tab === 'upcoming'
                    ? 'Nie masz zaplanowanych wizyt. Dodaj nową, gdy poznasz termin.'
                    : 'Odbyte, odwołane i niepotwierdzone wizyty pojawią się tutaj.'
                }
                action={tab === 'upcoming' ? addButton : undefined}
              />
            ) : (
              <div className="space-y-6">
                {days.map((day) => (
                  <section
                    key={day.date}
                    aria-labelledby={`appointments-day-${day.date}`}
                    className="space-y-3"
                  >
                    <h3 id={`appointments-day-${day.date}`} className="font-semibold">
                      {formatLocalDate(day.date)}
                    </h3>
                    <ul className="space-y-3">
                      {day.appointments.map((appointment) => (
                        <AppointmentCard
                          key={appointment.id}
                          appointment={appointment}
                          phase={classifyAppointment(appointment, now)}
                          timeZone={timeZone}
                          pending={pending}
                          isBusy={isBusy}
                          onStatus={(target, status) => {
                            void changeStatus(target, status);
                          }}
                          onDelete={(target) => {
                            setNotice(null);
                            setProblem(null);
                            setDeleteTarget(target);
                          }}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        title={
          deleteTarget === null
            ? 'Trwale usunąć wizytę?'
            : `Trwale usunąć wizytę „${appointmentTitle(deleteTarget)}”?`
        }
        confirmLabel="Usuń wizytę"
        isConfirming={action.isRunning}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={closeDeleteDialog}
      >
        {deleteTarget !== null && (
          <>
            <p>
              <strong className="break-words text-ink">{describe(deleteTarget, timeZone)}</strong>
            </p>
            <p>
              Wizyta zostanie <strong className="text-ink">trwale usunięta</strong> z listy. Tej
              operacji nie można cofnąć.
            </p>
            <p>
              Jeśli wizyta się nie odbyła albo została odwołana, możesz zamiast usuwać ją oznaczyć
              jako odwołaną: zostanie na liście minionych wizyt.
            </p>
            {action.error !== null && (
              <p
                role="alert"
                className="rounded-control border border-danger-600 bg-danger-50 p-3 text-sm font-medium text-danger-700"
              >
                Nie usunięto wizyty. {action.error.message}
              </p>
            )}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
