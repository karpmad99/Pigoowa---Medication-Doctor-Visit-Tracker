import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import type { Medication, StockBasis } from '@/features/medications/types';
import { isRollbackFailure, type RepositoryError } from '@/services/errors';
import type { LocalDate, Timestamp } from '@/types/primitives';
import { buildStartTracking, type StartTrackingIssueCode } from '../logic/startTracking';

interface StartTrackingDialogProps {
  /** The medication to start tracking, or `null` while the dialog is closed. */
  medication: Medication | null;
  now: () => Timestamp;
  today: LocalDate;
  isSaving: boolean;
  failure: RepositoryError | null;
  /** Called only with a medication that has a valid baseline. */
  onConfirm: (medication: Medication) => void;
  onCancel: () => void;
}

const issueMessages: Record<StartTrackingIssueCode, string> = {
  'mode-required':
    'Wybierz, jak zaczynasz: policzyłem, ile mam, albo zaczynam od nowego opakowania.',
  'quantity-required':
    'Wpisz ilość. Puste pole nie oznacza zera: jeśli nic nie masz, wpisz 0 (przy wyborze „policzyłem”).',
  'quantity-invalid':
    'Wpisz ilość jako liczbę równą lub większą od zera (do 3 miejsc po przecinku).',
  'package-size-zero': 'Nowe opakowanie musi zawierać więcej niż zero.',
  'already-tracking': 'Ten lek ma już policzony zapas.',
  'medication-ended': 'Ten lek jest zakończony, więc nie zaczynamy śledzić jego zapasu.',
};

const modeOptions: { value: StockBasis; label: string; description: string }[] = [
  {
    value: 'counted',
    label: 'Policzyłem, ile mam teraz',
    description: 'Wpisz, ile leku masz w tej chwili. Wpisane 0 oznacza, że nic nie zostało.',
  },
  {
    value: 'new-package',
    label: 'Zaczynam od nowego opakowania',
    description:
      'Wpisz, ile jest w nowym opakowaniu. Wcześniejszej pozostałości nie uwzględniamy, więc zapas może być większy, niż pokażemy.',
  },
];

function StartForm({
  formId,
  medication,
  now,
  today,
  onConfirm,
}: { formId: string; medication: Medication } & Pick<
  StartTrackingDialogProps,
  'now' | 'today' | 'onConfirm'
>) {
  const [mode, setMode] = useState<StockBasis | null>(null);
  const [quantity, setQuantity] = useState('');
  const [issues, setIssues] = useState<StartTrackingIssueCode[]>([]);
  const modeIssue = issues.find(
    (code) =>
      code === 'mode-required' || code === 'already-tracking' || code === 'medication-ended',
  );
  const quantityIssue = issues.find(
    (code) =>
      code === 'quantity-required' || code === 'quantity-invalid' || code === 'package-size-zero',
  );
  const quantityLabel =
    mode === 'new-package'
      ? 'Ile jest w nowym opakowaniu'
      : mode === 'counted'
        ? 'Ile masz teraz'
        : 'Ilość';
  const modeErrorId = useId();

  return (
    <form
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const built = buildStartTracking({
          medication,
          mode,
          quantityText: quantity,
          now: now(),
          today,
        });
        if (!built.ok) {
          setIssues(built.issues);
          return;
        }
        setIssues([]);
        onConfirm(built.medication);
      }}
    >
      <p>
        Bez policzonego zapasu nie pokazujemy żadnej liczby. Wybierz jeden ze sposobów i wpisz
        ilość. Nic nie jest zapisywane, dopóki nie potwierdzisz.
      </p>
      <fieldset
        className="space-y-3"
        aria-describedby={modeIssue === undefined ? undefined : modeErrorId}
      >
        <legend className="text-sm font-semibold text-ink">Jak zaczynasz śledzić zapas?</legend>
        {modeOptions.map((option) => (
          <label
            key={option.value}
            className="grid min-h-11 cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-control border border-line-strong p-3 has-checked:border-brand-700 has-checked:bg-brand-50"
          >
            <input
              type="radio"
              name="start-mode"
              value={option.value}
              checked={mode === option.value}
              onChange={() => {
                setMode(option.value);
              }}
              className="row-span-2 mt-1 size-5 accent-brand-700"
            />
            <span className="font-semibold">{option.label}</span>
            <span className="text-sm text-ink-muted">{option.description}</span>
          </label>
        ))}
        {modeIssue !== undefined && (
          <p id={modeErrorId} role="alert" className="text-sm font-medium text-danger-700">
            {issueMessages[modeIssue]}
          </p>
        )}
      </fieldset>
      <FormField
        label={quantityLabel}
        hint={`W jednostce dawki: ${medication.doseUnit.trim()}. Jednostek nie przeliczamy.`}
        error={quantityIssue === undefined ? undefined : issueMessages[quantityIssue]}
        required
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
          />
        )}
      </FormField>
    </form>
  );
}

/**
 * Creates the stock baseline of a medication that has none (PROJECT_SPEC DEC-52), with two explicit
 * choices and no default: counted, or from a new package. If the person chooses neither, leaves the
 * field empty or cancels, nothing is created and the estimate stays unavailable.
 */
export function StartTrackingDialog({
  medication,
  now,
  today,
  isSaving,
  failure,
  onConfirm,
  onCancel,
}: StartTrackingDialogProps) {
  const formId = useId();
  return (
    <Dialog
      open={medication !== null}
      onClose={onCancel}
      title={
        medication === null ? 'Zacznij śledzić zapas' : `Zacznij śledzić zapas: ${medication.name}`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Anuluj
          </Button>
          <Button type="submit" form={formId} isLoading={isSaving}>
            Zacznij śledzić zapas
          </Button>
        </>
      }
    >
      {medication !== null && (
        <StartForm
          key={medication.id}
          formId={formId}
          medication={medication}
          now={now}
          today={today}
          onConfirm={onConfirm}
        />
      )}
      {failure && (
        <p role="alert" className="mt-4 text-sm font-medium text-danger-700">
          {failure.message}
          {isRollbackFailure(failure) &&
            ' Dane mogą być niespójne: odśwież stronę i sprawdź zapas leku.'}
        </p>
      )}
    </Dialog>
  );
}
