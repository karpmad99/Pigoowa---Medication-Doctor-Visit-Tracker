import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { formatAmount } from '@/features/medications/logic/unitForms';
import type { DetailsResult } from '../hooks/useDoseActions';
import { DOSE_NOTE_MAX } from '../logic/limits';
import type { TakenDetails } from '../logic/recording';
import { parseTakenDetails, type TakenDetailsIssue } from '../logic/takenDetails';
import type { ScheduledDose } from '../types';

interface TakenAmountDialogProps {
  /** The dose to record or edit, or `null` while the dialog is closed. */
  dose: ScheduledDose | null;
  isSaving: boolean;
  /** Saves; the dialog closes itself on `saved` and `stale`, and shows the reason on `failed`. */
  onSubmit: (dose: ScheduledDose, details: TakenDetails) => Promise<DetailsResult>;
  onClose: () => void;
}

const issueMessages: Record<TakenDetailsIssue, string> = {
  'amount-invalid':
    'Wpisz ilość większą od zera, na przykład 1 lub 0,5 (do 3 miejsc po przecinku).',
  'note-too-long': `Notatka może mieć najwyżej ${String(DOSE_NOTE_MAX)} znaków.`,
};

/** A quantity as it is typed in Polish: the decimal comma, no thousands separator. */
function quantityText(value: number): string {
  return String(value).replace('.', ',');
}

function DetailsForm({
  formId,
  dose,
  onSubmit,
  onClose,
}: {
  formId: string;
  dose: ScheduledDose;
  onSubmit: TakenAmountDialogProps['onSubmit'];
  onClose: () => void;
}) {
  const log = dose.log;
  const editing = log !== null && log.status === 'taken';
  const planned = editing ? log.doseAmount : dose.doseAmount;
  const unit = editing ? log.doseUnit : dose.doseUnit;
  const [amount, setAmount] = useState(
    quantityText(editing ? (log.takenAmount ?? log.doseAmount) : dose.doseAmount),
  );
  const [note, setNote] = useState(editing ? (log.note ?? '') : '');
  const [issues, setIssues] = useState<TakenDetailsIssue[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <form
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseTakenDetails({ amountText: amount, noteText: note });
        if (!parsed.ok) {
          setIssues(parsed.issues);
          return;
        }
        setIssues([]);
        setFailure(null);
        void onSubmit(dose, { takenAmount: parsed.takenAmount, note: parsed.note }).then(
          (result) => {
            if (result.status === 'failed') setFailure(result.message);
            else if (result.status !== 'ignored') onClose();
          },
        );
      }}
    >
      <p>
        Wpisz, ile leku faktycznie zostało przyjęte. Zapisujemy to, co się wydarzyło, obok planu:
        aplikacja niczego nie ocenia, nie podpowiada dawki i nie zmienia harmonogramu.
      </p>
      <p className="rounded-card border border-line bg-canvas p-3 text-base">
        Zaplanowano: <strong>{formatAmount(planned, unit)}</strong>. Plan zostaje taki, jaki był.
      </p>
      <FormField
        label="Ile przyjęto"
        hint={`W jednostce dawki: ${unit.trim()}. Może być więcej albo mniej niż w planie.`}
        error={issues.includes('amount-invalid') ? issueMessages['amount-invalid'] : undefined}
        required
      >
        {(control) => (
          <Input
            {...control}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField
        label="Notatka (opcjonalnie)"
        hint={`Na przykład powód innej ilości, jeśli chcesz go zapamiętać. Nie wpisuj więcej danych, niż potrzebujesz. Do ${String(DOSE_NOTE_MAX)} znaków.`}
        error={issues.includes('note-too-long') ? issueMessages['note-too-long'] : undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </FormField>
      {failure !== null && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {failure}
        </p>
      )}
    </form>
  );
}

/**
 * Records the amount actually taken and an optional note, either together with marking a dose as
 * taken (a dose with no record yet) or on a dose that is already taken. It only records what the
 * person says: the plan stays as it was, the amount may be larger or smaller than it, and nothing
 * here suggests, rates or changes a dose. A failed save keeps the form and says why.
 */
export function TakenAmountDialog({ dose, isSaving, onSubmit, onClose }: TakenAmountDialogProps) {
  const formId = useId();
  const editing = dose?.log?.status === 'taken';
  const context = dose === null ? '' : `${dose.medicationName}, ${dose.time}`;
  return (
    <Dialog
      open={dose !== null}
      onClose={onClose}
      title={editing ? `Zmień ilość lub notatkę: ${context}` : `Przyjęto inną ilość: ${context}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" form={formId} isLoading={isSaving}>
            {editing ? 'Zapisz zmiany' : 'Zapisz jako przyjętą'}
          </Button>
        </>
      }
    >
      {/* Remounted for each dose and each opening, so the form always starts from what is stored. */}
      {dose !== null && (
        <DetailsForm
          key={`${dose.medicationId}-${dose.date}-${dose.time}-${dose.log?.recordedAt ?? 'new'}`}
          formId={formId}
          dose={dose}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}
