import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { flashNotice } from '@/app/flashNotice';
import { PageHeader } from '@/components/layout/PageHeader';
import { AppointmentForm } from '@/features/appointments/components/AppointmentForm';
import {
  appointmentTitle,
  emptyAppointmentForm,
  type AppointmentFormValues,
} from '@/features/appointments/logic/appointmentForm';
import { createAppointmentFromForm } from '@/features/appointments/logic/saveAppointment';
import { classifyAppointment } from '@/features/appointments/logic/status';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { RepositoryError } from '@/services/errors';

export function AddAppointmentPage() {
  usePageTitle('Dodaj wizytę');
  const { clock, timeZone, createId, repositories } = useServices();
  const navigate = useNavigate();
  const action = useAsyncAction({ blockAfterSuccess: true });
  const initialValues = useMemo(() => emptyAppointmentForm(), []);
  // One id for this form, chosen when it opens. Even if "save" were somehow triggered twice, the
  // second attempt would carry the same id and be refused as a duplicate: it can never add a
  // second appointment.
  const [appointmentId] = useState(() => createId());

  const save = async (values: AppointmentFormValues) => {
    const created = createAppointmentFromForm(values, {
      id: appointmentId,
      now: clock.now(),
      timeZone,
    });
    const outcome = await action.run(() => {
      if (!created.ok) return Promise.reject(new RepositoryError('invalid-input'));
      return repositories.appointments.create(created.appointment);
    });
    if (outcome.status === 'success') {
      // An appointment dated in the past is listed under "Minione" ("Do potwierdzenia"): go there.
      const phase = classifyAppointment(outcome.value, clock.now());
      void navigate(
        phase === 'upcoming' ? '/appointments' : '/appointments?tab=past',
        flashNotice(`Dodano wizytę: ${appointmentTitle(outcome.value)}.`),
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Dodaj wizytę"
        description="Podaj lekarza lub specjalizację oraz datę i godzinę wizyty."
      />
      <AppointmentForm
        initialValues={initialValues}
        submitLabel="Dodaj wizytę"
        isSaving={action.isRunning}
        saveError={action.error}
        timeZone={timeZone}
        onSubmit={(values) => {
          void save(values);
        }}
      />
    </>
  );
}
