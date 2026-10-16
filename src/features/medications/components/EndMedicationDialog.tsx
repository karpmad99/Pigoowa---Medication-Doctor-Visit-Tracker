import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { isRollbackFailure, type RepositoryError } from '@/services/errors';
import type { LocalDate } from '@/types/primitives';
import type { Medication } from '../types';

interface EndMedicationDialogProps {
  /** The medication to end, or `null` while the dialog is closed. */
  medication: Medication | null;
  /** The date offered first: today, or the start date if the medication starts later. */
  defaultDate: LocalDate;
  isEnding: boolean;
  /** A problem with the chosen date, shown at the field. */
  dateError: string | null;
  /** Why saving failed, if it did. */
  failure: RepositoryError | null;
  onConfirm: (dateText: string) => void;
  onCancel: () => void;
}

function EndDateForm({
  formId,
  defaultDate,
  dateError,
  onConfirm,
}: Pick<EndMedicationDialogProps, 'defaultDate' | 'dateError' | 'onConfirm'> & { formId: string }) {
  const [date, setDate] = useState<string>(defaultDate);
  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(date);
      }}
    >
      <FormField
        label="Ostatni dzień przyjmowania"
        hint="Od następnego dnia lek nie będzie już planowany."
        error={dateError ?? undefined}
        required
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        )}
      </FormField>
    </form>
  );
}

/**
 * Ending a medication is the main way to stop it: it sets the last day of use and keeps the
 * whole intake history. Permanent deletion is a separate, secondary action.
 */
export function EndMedicationDialog({
  medication,
  defaultDate,
  isEnding,
  dateError,
  failure,
  onConfirm,
  onCancel,
}: EndMedicationDialogProps) {
  const formId = useId();
  return (
    <Dialog
      open={medication !== null}
      onClose={onCancel}
      title={medication === null ? 'Zakończyć lek?' : `Zakończyć lek „${medication.name}”?`}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Anuluj
          </Button>
          <Button type="submit" form={formId} isLoading={isEnding}>
            Zakończ lek
          </Button>
        </>
      }
    >
      <p>Lek zniknie z harmonogramu po wybranym dniu. Historia przyjmowania zostanie zachowana.</p>
      {/* Remounted for each medication, so the date always starts from the right default. */}
      <EndDateForm
        key={medication?.id ?? 'closed'}
        formId={formId}
        defaultDate={defaultDate}
        dateError={dateError}
        onConfirm={onConfirm}
      />
      {failure && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {failure.message}
          {isRollbackFailure(failure) &&
            ' Dane mogą być niespójne: odśwież stronę i sprawdź listę leków.'}
        </p>
      )}
    </Dialog>
  );
}
