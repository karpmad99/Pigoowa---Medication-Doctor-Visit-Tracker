import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { flashNotice } from '@/app/flashNotice';
import { PageHeader } from '@/components/layout/PageHeader';
import { MedicationForm } from '@/features/medications/components/MedicationForm';
import {
  emptyMedicationForm,
  readMedicationForm,
  type MedicationFormValues,
} from '@/features/medications/logic/medicationForm';
import { createMedicationFromForm } from '@/features/medications/logic/saveMedication';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { RepositoryError } from '@/services/errors';
import { getLocalDateInZone } from '@/utils/timeZone';

export function AddMedicationPage() {
  usePageTitle('Dodaj lek');
  const { clock, timeZone, createId, repositories } = useServices();
  const navigate = useNavigate();
  const action = useAsyncAction({ blockAfterSuccess: true });
  const today = getLocalDateInZone(clock.now(), timeZone);
  const initialValues = useMemo(() => emptyMedicationForm(today), [today]);
  // One id for this form, chosen when it opens. Even if "save" were somehow triggered twice, the
  // second attempt would carry the same id and be refused as a duplicate: it can never add a
  // second medication.
  const [medicationId] = useState(() => createId());

  const save = async (values: MedicationFormValues) => {
    const fields = readMedicationForm(values);
    const created =
      fields === null
        ? null
        : createMedicationFromForm(fields, {
            id: medicationId,
            now: clock.now(),
            today,
            createId,
          });
    const outcome = await action.run(() => {
      if (!created?.ok) {
        return Promise.reject(new RepositoryError('invalid-input'));
      }
      return repositories.medications.create(created.medication);
    });
    if (outcome.status === 'success') {
      void navigate('/medications', flashNotice(`Dodano lek „${outcome.value.name}”.`));
    }
  };

  return (
    <>
      <PageHeader
        title="Dodaj lek"
        description="Podaj nazwę, godziny przyjmowania i dawki. Harmonogram ustawiasz samodzielnie."
      />
      <MedicationForm
        initialValues={initialValues}
        submitLabel="Dodaj lek"
        isSaving={action.isRunning}
        saveError={action.error}
        onSubmit={(values) => {
          void save(values);
        }}
      />
    </>
  );
}
