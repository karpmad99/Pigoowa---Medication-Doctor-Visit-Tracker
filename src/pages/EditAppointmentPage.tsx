import { useNavigate, useParams } from 'react-router';
import { flashNotice } from '@/app/flashNotice';
import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { saveAppointmentEdit } from '@/features/appointments/appointmentActions';
import { AppointmentForm } from '@/features/appointments/components/AppointmentForm';
import { useAppointment } from '@/features/appointments/hooks/useAppointment';
import {
  appointmentTitle,
  appointmentToFormValues,
  type AppointmentFormValues,
} from '@/features/appointments/logic/appointmentForm';
import { classifyAppointment } from '@/features/appointments/logic/status';
import type { Appointment } from '@/features/appointments/types';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { RepositoryError } from '@/services/errors';

function EditForm({ appointment }: { appointment: Appointment }) {
  const { clock, timeZone, repositories } = useServices();
  const navigate = useNavigate();
  const action = useAsyncAction({ blockAfterSuccess: true });

  const save = async (values: AppointmentFormValues) => {
    const outcome = await action.run(async () => {
      const result = await saveAppointmentEdit({
        repositories,
        id: appointment.id,
        values,
        now: clock.now(),
        timeZone,
      });
      if (!result.ok) throw new RepositoryError('invalid-input');
      return result;
    });
    if (outcome.status === 'success') {
      const { appointment: saved, changed } = outcome.value;
      const phase = classifyAppointment(saved, clock.now());
      void navigate(
        phase === 'upcoming' ? '/appointments' : '/appointments?tab=past',
        flashNotice(
          changed
            ? `Zapisano zmiany w wizycie: ${appointmentTitle(saved)}.`
            : `Nie wprowadzono zmian w wizycie: ${appointmentTitle(saved)}.`,
        ),
      );
    }
  };

  return (
    <AppointmentForm
      initialValues={appointmentToFormValues(appointment, timeZone)}
      submitLabel="Zapisz zmiany"
      isSaving={action.isRunning}
      saveError={action.error}
      timeZone={timeZone}
      onSubmit={(values) => {
        void save(values);
      }}
    />
  );
}

export function EditAppointmentPage() {
  usePageTitle('Edytuj wizytę');
  const { appointmentId = '' } = useParams();
  const appointment = useAppointment(appointmentId);

  return (
    <>
      <PageHeader
        title="Edytuj wizytę"
        description="Zmiana szczegółów nie zmienia statusu wizyty (zaplanowana, odbyta, odwołana)."
      />
      {appointment.isLoading && <Spinner label="Wczytywanie wizyty…" />}
      {appointment.error?.code === 'not-found' && (
        <EmptyState
          icon="calendar"
          title="Nie znaleziono wizyty"
          description="Ta wizyta nie istnieje. Mogła zostać usunięta."
          action={<ButtonLink to="/appointments">Wróć do listy wizyt</ButtonLink>}
        />
      )}
      {appointment.error !== undefined && appointment.error.code !== 'not-found' && (
        <ErrorState
          title="Nie udało się wczytać wizyty"
          message={appointment.error.message}
          onRetry={appointment.reload}
        />
      )}
      {appointment.data !== undefined && (
        <EditForm key={appointment.data.id} appointment={appointment.data} />
      )}
    </>
  );
}
