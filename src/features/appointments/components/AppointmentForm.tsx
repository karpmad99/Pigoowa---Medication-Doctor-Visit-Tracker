import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField } from '@/components/ui/FormField';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import type { RepositoryError } from '@/services/errors';
import { isAmbiguousLocalTime, type AppointmentFormValues } from '../logic/appointmentForm';
import { createAppointmentFormSchema } from '../schemas';

interface AppointmentFormProps {
  /** The values to start from: an empty form, or an existing appointment. */
  initialValues: AppointmentFormValues;
  submitLabel: string;
  isSaving: boolean;
  /** Why the last save failed, if it did. The typed values stay in the form either way. */
  saveError: RepositoryError | null;
  /** IANA zone in which the typed date and time are meant. */
  timeZone: string;
  /** Called only with values that passed validation. */
  onSubmit: (values: AppointmentFormValues) => void;
}

/**
 * The add/edit form for an appointment. React Hook Form keeps the typed values; the Zod schema
 * (Polish messages over the Stage 2 rules) validates them. Nothing is cleared by a failed
 * validation or a failed save, errors are tied to their fields for screen readers, and the first
 * invalid field gets focus. `noValidate` stops the browser's own pop-ups from replacing them.
 */
export function AppointmentForm({
  initialValues,
  submitLabel,
  isSaving,
  saveError,
  timeZone,
  onSubmit,
}: AppointmentFormProps) {
  const schema = useMemo(() => createAppointmentFormSchema(timeZone), [timeZone]);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AppointmentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const date = useWatch({ control, name: 'date' });
  const time = useWatch({ control, name: 'time' });
  const ambiguous = isAmbiguousLocalTime(date, time, timeZone);

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
        <span className="sr-only">gwiazdką</span> są wymagane. Wymagane jest też wpisanie lekarza
        lub specjalizacji (wystarczy jedno z nich).
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Lekarz" error={errors.doctorName?.message}>
          {(field) => (
            <Input
              {...field}
              autoComplete="off"
              placeholder="na przykład dr Nowak"
              {...register('doctorName')}
            />
          )}
        </FormField>
        <FormField label="Specjalizacja" error={errors.specialty?.message}>
          {(field) => (
            <Input
              {...field}
              autoComplete="off"
              placeholder="na przykład kardiolog"
              {...register('specialty')}
            />
          )}
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Data wizyty" error={errors.date?.message} required>
          {(field) => <Input {...field} type="date" {...register('date')} />}
        </FormField>
        <FormField label="Godzina wizyty" error={errors.time?.message} required>
          {(field) => <Input {...field} type="time" {...register('time')} />}
        </FormField>
      </div>
      {ambiguous && (
        <p className="flex gap-2 text-sm font-medium text-warning-800">
          <Icon name="alert" className="mt-0.5 size-4" />
          <span>
            Tej nocy zegary cofają się, więc ta godzina występuje dwa razy. Zapiszemy ją jako
            wcześniejszą z nich.
          </span>
        </p>
      )}

      <div className="space-y-5">
        <FormField label="Miejsce" hint="Opcjonalnie." error={errors.location?.message}>
          {(field) => <Input {...field} autoComplete="off" {...register('location')} />}
        </FormField>
        <FormField
          label="Notatki"
          hint="Opcjonalnie. Nie wpisuj więcej danych, niż potrzebujesz."
          error={errors.notes?.message}
        >
          {(field) => <Textarea {...field} {...register('notes')} />}
        </FormField>
      </div>

      {saveError && <ErrorState title="Nie zapisano wizyty" message={saveError.message} />}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <ButtonLink to="/appointments" variant="secondary">
          Anuluj
        </ButtonLink>
        <Button type="submit" isLoading={isSaving}>
          {isSaving ? 'Zapisywanie…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
