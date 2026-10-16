import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField } from '@/components/ui/FormField';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { isRollbackFailure, type RepositoryError } from '@/services/errors';
import type { MedicationFormValues } from '../logic/medicationForm';
import { unitsMatch } from '../logic/units';
import { medicationFormSchema } from '../schemas';
import { ScheduleTimesEditor } from './ScheduleTimesEditor';

interface MedicationFormProps {
  /** The values to start from: an empty form, or an existing medication. */
  initialValues: MedicationFormValues;
  submitLabel: string;
  isSaving: boolean;
  /** Why the last save failed, if it did. The typed values stay in the form either way. */
  saveError: RepositoryError | null;
  /** The unit the saved stock is counted in (when editing), to warn if it no longer matches the dose unit. */
  storedStockUnit?: string | null;
  /** Called only with values that passed validation. */
  onSubmit: (values: MedicationFormValues) => void;
}

/**
 * The add/edit form. React Hook Form keeps the typed values, and the Zod schema (Polish
 * messages over the Stage 2 rules) validates them. Nothing is cleared by a failed validation or
 * a failed save. Fields use `noValidate` on the form so that the browser's own pop-ups do not
 * replace the messages below, which are tied to their fields for screen readers.
 */
export function MedicationForm({
  initialValues,
  submitLabel,
  isSaving,
  saveError,
  storedStockUnit = null,
  onSubmit,
}: MedicationFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<MedicationFormValues>({
    resolver: zodResolver(medicationFormSchema),
    defaultValues: initialValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const doseUnit = useWatch({ control, name: 'doseUnit' }).trim();
  const stockUnitChanged =
    storedStockUnit !== null && doseUnit !== '' && !unitsMatch(storedStockUnit, doseUnit);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
      className="space-y-8"
    >
      <p className="text-sm text-ink-muted">
        Pola oznaczone <span aria-hidden="true">*</span>
        <span className="sr-only">gwiazdką</span> są wymagane.
      </p>

      <div className="space-y-5">
        <FormField label="Nazwa leku" error={errors.name?.message} required>
          {(field) => <Input {...field} autoComplete="off" {...register('name')} />}
        </FormField>
        <FormField
          label="Jednostka dawki"
          hint="Na przykład: tabletka, ml, mg."
          error={errors.doseUnit?.message}
          required
        >
          {(field) => <Input {...field} autoComplete="off" {...register('doseUnit')} />}
        </FormField>
      </div>

      <ScheduleTimesEditor control={control} register={register} errors={errors} />

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Data rozpoczęcia" error={errors.startDate?.message} required>
          {(field) => <Input {...field} type="date" {...register('startDate')} />}
        </FormField>
        <FormField
          label="Data zakończenia"
          hint="Ostatni dzień przyjmowania. Zostaw puste, jeśli lek nie ma daty zakończenia."
          error={errors.endDate?.message}
        >
          {(field) => <Input {...field} type="date" {...register('endDate')} />}
        </FormField>
      </div>

      <div className="space-y-3">
        <FormField
          label="Aktualny zapas"
          hint={
            doseUnit === ''
              ? 'Opcjonalnie. Wpisz, ile leku masz teraz, w jednostce dawki.'
              : `Opcjonalnie. Wpisz, ile leku masz teraz, w jednostce: ${doseUnit}. Zostaw puste, jeśli nie chcesz śledzić zapasu.`
          }
          error={errors.stockQuantity?.message}
        >
          {(field) => (
            <Input
              {...field}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              {...register('stockQuantity')}
            />
          )}
        </FormField>
        {stockUnitChanged && (
          <p className="flex gap-2 text-sm font-medium text-warning-800">
            <Icon name="alert" className="mt-0.5 size-4" />
            <span>
              Zapas jest zapisany w jednostce „{storedStockUnit}”, a jednostka dawki to „{doseUnit}
              ”. Wpisz zapas ponownie, aby szacunek był dostępny.
            </span>
          </p>
        )}
      </div>

      <FormField
        label="Notatki"
        hint="Opcjonalnie. Nie wpisuj więcej danych, niż potrzebujesz."
        error={errors.notes?.message}
      >
        {(field) => <Textarea {...field} {...register('notes')} />}
      </FormField>

      {saveError && (
        <ErrorState
          title="Nie zapisano leku"
          message={
            isRollbackFailure(saveError)
              ? `${saveError.message} Dane mogą być niespójne: odśwież stronę i sprawdź listę leków.`
              : saveError.message
          }
        />
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <ButtonLink to="/medications" variant="secondary">
          Anuluj
        </ButtonLink>
        <Button type="submit" isLoading={isSaving}>
          {isSaving ? 'Zapisywanie…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
