import { useRef } from 'react';
import {
  useFieldArray,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import type { MedicationFormValues, ScheduleTimeFormValues } from '../logic/medicationForm';

type RowFieldName<K extends keyof ScheduleTimeFormValues> = `scheduleTimes.${number}.${K}`;

/**
 * The name of one field of one schedule row, e.g. "scheduleTimes.2.timeOfDay". React Hook Form
 * types such names as `scheduleTimes.${number}.field`, but a template string built from a
 * variable is only known to be `string`. The assertion below is safe because `String(index)`
 * of an array index is always the digits of a number; it is kept here, in one place.
 */
function rowField<K extends keyof ScheduleTimeFormValues>(index: number, key: K): RowFieldName<K> {
  return `scheduleTimes.${String(index)}.${key}` as RowFieldName<K>;
}

interface ScheduleTimesEditorProps {
  control: Control<MedicationFormValues>;
  register: UseFormRegister<MedicationFormValues>;
  errors: FieldErrors<MedicationFormValues>;
}

/**
 * The list of daily administration times, each with its own dose. It is a real group
 * (`fieldset` + `legend`) so that screen readers announce it, and every control is labelled
 * with its row number ("Godzina 2", "Dawka 2", "Usuń godzinę 2"). Time inputs are the browser's
 * own, so no time-picker library is needed. The rules (valid time, positive dose, no repeated
 * time) are not here: they live in `validateMedicationForm`, which reuses Stage 2's rules.
 */
export function ScheduleTimesEditor({ control, register, errors }: ScheduleTimesEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'scheduleTimes' });
  const doseUnit = useWatch({ control, name: 'doseUnit' }).trim();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const scheduleError = errors.scheduleTimes?.root?.message ?? errors.scheduleTimes?.message;

  return (
    <fieldset className="space-y-4">
      <legend className="text-base font-semibold text-ink">Godziny przyjmowania</legend>
      <p className="text-sm text-ink-muted">
        {doseUnit === ''
          ? 'Dla każdej godziny wpisz dawkę. Najpierw podaj jednostkę dawki.'
          : `Dla każdej godziny wpisz dawkę w jednostce: ${doseUnit}.`}{' '}
        Harmonogram ustawiasz samodzielnie. Nie zastępuje zaleceń lekarza.
      </p>

      <ul className="space-y-3">
        {fields.map((field, index) => {
          const rowErrors = errors.scheduleTimes?.[index];
          const number = String(index + 1);
          return (
            <li
              key={field.id}
              className="grid grid-cols-[1fr_1fr] items-start gap-3 rounded-card border border-line p-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <input type="hidden" {...register(rowField(index, 'scheduleTimeId'))} />
              <FormField label={`Godzina ${number}`} error={rowErrors?.timeOfDay?.message} required>
                {(control) => (
                  <Input {...control} type="time" {...register(rowField(index, 'timeOfDay'))} />
                )}
              </FormField>
              <FormField label={`Dawka ${number}`} error={rowErrors?.doseAmount?.message} required>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    {...register(rowField(index, 'doseAmount'))}
                  />
                )}
              </FormField>
              <div className="col-span-2 sm:col-span-1 sm:pt-7">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    remove(index);
                    // The row that had focus is gone: send focus somewhere predictable.
                    addButtonRef.current?.focus();
                  }}
                >
                  <Icon name="close" className="size-4" />
                  Usuń godzinę {number}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {scheduleError && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {scheduleError}
        </p>
      )}

      <Button
        ref={addButtonRef}
        variant="secondary"
        onClick={() => {
          // Focus the new row's time field. By default React Hook Form would focus the row's
          // first registered field, which here is the hidden id field and cannot take focus.
          append(
            { scheduleTimeId: '', timeOfDay: '', doseAmount: '' },
            { focusName: rowField(fields.length, 'timeOfDay') },
          );
        }}
      >
        Dodaj godzinę
      </Button>
    </fieldset>
  );
}
