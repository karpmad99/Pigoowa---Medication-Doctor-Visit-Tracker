import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField } from '@/components/ui/FormField';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { isRollbackFailure, type RepositoryError } from '@/services/errors';
import {
  DOSAGE_FORMS,
  isDosageForm,
  listedUnits,
  STRENGTH_UNITS,
  unitChoices,
} from '../logic/dosageForms';
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
  /**
   * The dose unit and the stock unit as stored (when editing). A stored unit that is not on the
   * list for the chosen form is offered as the first option, written as stored, until another
   * unit is saved.
   */
  storedDoseUnit?: string | null;
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
  storedDoseUnit = null,
  storedStockUnit = null,
  onSubmit,
}: MedicationFormProps) {
  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<MedicationFormValues>({
    resolver: zodResolver(medicationFormSchema),
    defaultValues: initialValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const rawDoseUnit = useWatch({ control, name: 'doseUnit' });
  const doseUnit = rawDoseUnit.trim();
  const rawStockUnit = useWatch({ control, name: 'stockUnit' });
  const stockQuantity = useWatch({ control, name: 'stockQuantity' });
  const thresholdText = useWatch({ control, name: 'lowStockThreshold' });
  const thresholdUnit = useWatch({ control, name: 'lowStockThresholdUnit' });
  const chosenForm = useWatch({ control, name: 'dosageForm' });
  const form = isDosageForm(chosenForm) ? chosenForm : null;
  const doseList = listedUnits(form, 'dose');
  const stockList = listedUnits(form, 'stock');
  const doseChoices = unitChoices(doseList, storedDoseUnit, rawDoseUnit);
  const stockChoices = unitChoices(stockList, storedStockUnit, rawStockUnit);
  // Empty means "the same as the dose unit". A different unit is allowed but never converted:
  // the form says at once that no estimate will be possible.
  const stockUnit = rawStockUnit.trim() === '' ? doseUnit : rawStockUnit.trim();
  const stockUnitsDiffer =
    stockQuantity.trim() !== '' &&
    doseUnit !== '' &&
    stockUnit !== '' &&
    !unitsMatch(stockUnit, doseUnit);
  // A stored threshold counted in another unit than the stock is not applied (DEC-46): say so at
  // once, and let the person count it in the stock unit with one explicit action.
  const thresholdUnitDiffers =
    thresholdText.trim() !== '' &&
    thresholdUnit.trim() !== '' &&
    stockUnit !== '' &&
    !unitsMatch(thresholdUnit, stockUnit);
  const storedDoseUnitOutside = doseChoices.choices.some((choice) => choice.outsideList);
  const storedStockUnitOutside = stockChoices.choices.some((choice) => choice.outsideList);

  /** A unit that is neither the stored one nor on the new list is cleared, never replaced by another. */
  const keepUnit = (unit: string, list: readonly string[], stored: string | null) =>
    unit === '' ||
    unit === stored ||
    list.length === 0 ||
    unitChoices(list, stored, unit).selected !== null;

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
          label="Postać leku"
          hint="Opcjonalnie. Po wybraniu postaci podpowiemy jednostki z listy. Zmiana postaci nie zmienia zapisanych jednostek."
          error={errors.dosageForm?.message}
        >
          {(field) => (
            <Controller
              control={control}
              name="dosageForm"
              render={({ field: formField }) => (
                <Select
                  {...field}
                  name={formField.name}
                  ref={formField.ref}
                  onBlur={formField.onBlur}
                  value={formField.value}
                  onChange={(event) => {
                    const next = event.target.value;
                    formField.onChange(next);
                    const nextForm = isDosageForm(next) ? next : null;
                    if (!keepUnit(rawDoseUnit, listedUnits(nextForm, 'dose'), storedDoseUnit)) {
                      setValue('doseUnit', '');
                    }
                    if (!keepUnit(rawStockUnit, listedUnits(nextForm, 'stock'), storedStockUnit)) {
                      setValue('stockUnit', '');
                    }
                  }}
                >
                  <option value="">Nie wybrano</option>
                  {DOSAGE_FORMS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              )}
            />
          )}
        </FormField>
        <FormField
          label="Jednostka dawki"
          hint={
            doseList.length === 0
              ? 'Na przykład: tabletka lub ml. Wybierz postać leku, jeśli wolisz wybrać jednostkę z listy.'
              : storedDoseUnitOutside
                ? 'Ta jednostka jest zapisana przy leku, ale nie ma jej na liście dla wybranej postaci. Możesz ją zostawić. Gdy zapiszesz inną jednostkę, nie będzie już można do niej wrócić.'
                : 'Wybierz jednostkę z listy dla wybranej postaci.'
          }
          error={errors.doseUnit?.message}
          required
        >
          {(field) =>
            doseList.length === 0 ? (
              <Input {...field} autoComplete="off" {...register('doseUnit')} />
            ) : (
              <Controller
                control={control}
                name="doseUnit"
                render={({ field: unitField }) => (
                  <Select
                    {...field}
                    name={unitField.name}
                    ref={unitField.ref}
                    onBlur={unitField.onBlur}
                    value={doseChoices.selected ?? ''}
                    onChange={(event) => {
                      unitField.onChange(event.target.value);
                    }}
                  >
                    {doseChoices.selected === null && <option value="">Wybierz jednostkę</option>}
                    {doseChoices.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                )}
              />
            )
          }
        </FormField>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink">Moc leku (opcjonalnie)</legend>
          <p className="text-sm text-ink-muted">
            Na przykład 500 mg, tak jak jest napisane na opakowaniu. To tylko informacja: nie
            zmienia dawki ani zapasu i nie jest używana w żadnych obliczeniach.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Moc: liczba" error={errors.strengthValue?.message}>
              {(field) => (
                <Input
                  {...field}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  {...register('strengthValue')}
                />
              )}
            </FormField>
            <FormField label="Moc: jednostka" error={errors.strengthUnit?.message}>
              {(field) => (
                <Select {...field} {...register('strengthUnit')}>
                  <option value="">Nie podano</option>
                  {STRENGTH_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
        </fieldset>
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
            stockUnit === ''
              ? 'Opcjonalnie. Wpisz, ile leku masz teraz, w jednostce zapasu.'
              : `Opcjonalnie. Wpisz, ile leku masz teraz, w jednostce: ${stockUnit}. Zostaw puste, jeśli nie chcesz śledzić zapasu.`
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
        <FormField
          label="Jednostka zapasu"
          hint={
            stockList.length === 0
              ? 'Zostaw puste, aby liczyć w jednostce dawki.'
              : storedStockUnitOutside
                ? 'Ta jednostka zapasu jest zapisana przy leku, ale nie ma jej na liście dla wybranej postaci. Możesz ją zostawić. Gdy zapiszesz inną jednostkę, nie będzie już można do niej wrócić.'
                : 'Domyślnie taka sama jak jednostka dawki.'
          }
          error={errors.stockUnit?.message}
        >
          {(field) =>
            stockList.length === 0 ? (
              <Input
                {...field}
                autoComplete="off"
                placeholder={doseUnit === '' ? '' : `Jak jednostka dawki: ${doseUnit}`}
                {...register('stockUnit')}
              />
            ) : (
              <Controller
                control={control}
                name="stockUnit"
                render={({ field: unitField }) => (
                  <Select
                    {...field}
                    name={unitField.name}
                    ref={unitField.ref}
                    onBlur={unitField.onBlur}
                    value={stockChoices.selected ?? ''}
                    onChange={(event) => {
                      unitField.onChange(event.target.value);
                    }}
                  >
                    <option value="">
                      {doseUnit === ''
                        ? 'Taka jak jednostka dawki'
                        : `Taka jak jednostka dawki (${doseUnit})`}
                    </option>
                    {stockChoices.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                )}
              />
            )
          }
        </FormField>
        {stockUnitsDiffer && (
          <p role="status" className="flex gap-2 text-sm font-medium text-warning-800">
            <Icon name="alert" className="mt-0.5 size-4" />
            <span>
              Zapas jest liczony w jednostce „{stockUnit}”, a dawka w jednostce „{doseUnit}”. Nie
              przeliczamy jednostek, więc szacunek zapasu nie będzie dostępny. Wybierz tę samą
              jednostkę, jeśli chcesz go widzieć.
            </span>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <FormField
          label="Własny próg niskiego zapasu"
          hint={`Opcjonalnie. Ostrzeżenie „Niski zapas” pojawi się, gdy szacowany zapas będzie równy progowi lub mniejszy, w jednostce zapasu${stockUnit === '' ? '' : `: ${stockUnit}`}. Bez progu ostrzegamy, gdy zapasu wystarczy na mniej niż 7 dni.`}
          error={errors.lowStockThreshold?.message}
        >
          {(field) => (
            <Input
              {...field}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              {...register('lowStockThreshold', {
                onChange: () => {
                  // A number typed now is in the stock unit.
                  setValue('lowStockThresholdUnit', '');
                },
              })}
            />
          )}
        </FormField>
        {thresholdUnitDiffers && (
          <div role="status" className="space-y-2 text-sm font-medium text-warning-800">
            <p className="flex gap-2">
              <Icon name="alert" className="mt-0.5 size-4" />
              <span>
                Próg jest zapisany w jednostce „{thresholdUnit}”, a zapas jest liczony w jednostce „
                {stockUnit}”. Nie przeliczamy jednostek, więc próg nie działa i obowiązuje reguła 7
                dni.
              </span>
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setValue('lowStockThresholdUnit', '');
              }}
            >
              Licz ten próg w jednostce zapasu: {stockUnit}
            </Button>
          </div>
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
