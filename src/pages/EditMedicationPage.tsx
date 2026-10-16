import { useNavigate, useParams } from 'react-router';
import { flashNotice } from '@/app/flashNotice';
import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { MedicationForm } from '@/features/medications/components/MedicationForm';
import { useMedication } from '@/features/medications/hooks/useMedication';
import {
  medicationToFormValues,
  readMedicationForm,
  type MedicationFormValues,
} from '@/features/medications/logic/medicationForm';
import { applyMedicationEdit } from '@/features/medications/logic/saveMedication';
import type { Medication } from '@/features/medications/types';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { RepositoryError } from '@/services/errors';
import { getLocalDateInZone } from '@/utils/timeZone';

function EditForm({ medication }: { medication: Medication }) {
  const { clock, timeZone, createId, repositories } = useServices();
  const navigate = useNavigate();
  const action = useAsyncAction({ blockAfterSuccess: true });

  const save = async (values: MedicationFormValues) => {
    const fields = readMedicationForm(values);
    const edited =
      fields === null
        ? null
        : applyMedicationEdit(medication, fields, {
            now: clock.now(),
            today: getLocalDateInZone(clock.now(), timeZone),
            createId,
          });
    const outcome = await action.run(() => {
      if (!edited?.ok) {
        return Promise.reject(new RepositoryError('invalid-input'));
      }
      return repositories.medications.update(edited.medication);
    });
    if (outcome.status === 'success') {
      void navigate('/medications', flashNotice(`Zapisano zmiany w leku „${outcome.value.name}”.`));
    }
  };

  return (
    <MedicationForm
      initialValues={medicationToFormValues(medication)}
      submitLabel="Zapisz zmiany"
      isSaving={action.isRunning}
      saveError={action.error}
      storedStockUnit={medication.stock?.unit ?? null}
      onSubmit={(values) => {
        void save(values);
      }}
    />
  );
}

export function EditMedicationPage() {
  usePageTitle('Edytuj lek');
  const { medicationId = '' } = useParams();
  const medication = useMedication(medicationId);

  return (
    <>
      <PageHeader
        title="Edytuj lek"
        description="Zmiana nazwy, notatek lub zapasu nie zmienia harmonogramu. Historia przyjmowania pozostaje bez zmian."
      />
      {medication.isLoading && <Spinner label="Wczytywanie leku…" />}
      {medication.error?.code === 'not-found' && (
        <EmptyState
          icon="pill"
          title="Nie znaleziono leku"
          description="Ten lek nie istnieje. Mógł zostać usunięty."
          action={<ButtonLink to="/medications">Wróć do listy leków</ButtonLink>}
        />
      )}
      {medication.error !== undefined && medication.error.code !== 'not-found' && (
        <ErrorState
          title="Nie udało się wczytać leku"
          message={medication.error.message}
          onRetry={medication.reload}
        />
      )}
      {medication.data !== undefined && (
        <EditForm key={medication.data.id} medication={medication.data} />
      )}
    </>
  );
}
