import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { formatAmount } from '@/features/medications/logic/unitForms';
import type { Medication } from '@/features/medications/types';
import { isRollbackFailure, type RepositoryError } from '@/services/errors';
import type { Id, LocalDate, Timestamp } from '@/types/primitives';
import { parseQuantityInput, toThousandths } from '@/utils/quantity';
import { buildRefill, buildWaste, type RefillIssue } from '../logic/refill';
import { STOCK_EVENT_NOTE_MAX } from '../logic/limits';
import type { StockEvent, StockEventKind } from '../types';

export interface StockChangeTarget {
  kind: StockEventKind;
  medication: Medication;
  /** Created when the dialog was opened, so a repeated submit cannot record a second event. */
  eventId: Id;
  /**
   * The estimated amount in the stock unit right now, or `null` when there is no estimate. Used
   * only to warn that a waste amount is larger than the estimate; it never blocks anything.
   */
  remaining: number | null;
}

interface StockChangeDialogProps {
  target: StockChangeTarget | null;
  /** The moment of the confirmation: the event is recorded at this instant. */
  now: () => Timestamp;
  today: LocalDate;
  isSaving: boolean;
  failure: RepositoryError | null;
  onConfirm: (event: StockEvent) => void;
  onCancel: () => void;
}

/** What differs between the two kinds of stock change; the rest of the dialog is shared. */
const copy = {
  refill: {
    title: 'Uzupełnij zapas',
    submit: 'Uzupełnij zapas',
    amountLabel: 'Ile dokładasz',
    intro:
      'Wpisz, ile dokładasz do zapasu. Zapis dostanie dzisiejszą datę i godzinę; wcześniejszych dat nie ustawiamy.',
    amountError: 'Wpisz ilość większą od zera, na przykład 30 lub 0,5 (do 3 miejsc po przecinku).',
    noteHint: 'Na przykład skąd pochodzi opakowanie.',
  },
  waste: {
    title: 'Zapisz stratę',
    submit: 'Zapisz stratę',
    amountLabel: 'Ile się zmarnowało',
    intro:
      'Wpisz, ile leku się zmarnowało, rozlało lub zgubiło. Zmniejszymy o tyle szacowany zapas. To nie jest przyjęcie dawki: żadna dawka nie zostanie zapisana jako przyjęta ani pominięta, a harmonogram się nie zmieni. Zapis dostanie dzisiejszą datę i godzinę.',
    amountError: 'Wpisz ilość większą od zera, na przykład 2 lub 0,5 (do 3 miejsc po przecinku).',
    noteHint: 'Na przykład co się stało.',
  },
} as const;

const messages = {
  'note-too-long': `Notatka może mieć najwyżej ${String(STOCK_EVENT_NOTE_MAX)} znaków.`,
  'no-baseline':
    'Ten lek nie ma jeszcze policzonego zapasu, więc nie ma co zmieniać. Najpierw zacznij śledzić zapas.',
  'medication-ended': 'Ten lek jest zakończony, więc nie zmieniamy jego zapasu.',
} as const;

function ChangeForm({
  formId,
  target,
  now,
  today,
  onConfirm,
}: { formId: string } & Pick<StockChangeDialogProps, 'now' | 'today' | 'onConfirm'> & {
    target: StockChangeTarget;
  }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [issues, setIssues] = useState<RefillIssue[]>([]);
  const { medication, kind } = target;
  const text = copy[kind];
  const unit = medication.stock?.unit.trim() ?? '';
  const issueOf = (field: RefillIssue['field']) => issues.find((issue) => issue.field === field);

  // A waste amount above the estimate is allowed (an estimate must not block a fact), so it is
  // only said, while typing, what will be shown.
  const typed = parseQuantityInput(amount);
  const exceedsEstimate =
    kind === 'waste' &&
    target.remaining !== null &&
    typed !== null &&
    typed > 0 &&
    toThousandths(typed) > toThousandths(target.remaining);

  return (
    <form
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const build = kind === 'refill' ? buildRefill : buildWaste;
        const built = build({
          medication,
          amountText: amount,
          noteText: note,
          id: target.eventId,
          now: now(),
          today,
        });
        if (!built.ok) {
          setIssues(built.issues);
          return;
        }
        setIssues([]);
        onConfirm(built.event);
      }}
    >
      <p>{text.intro}</p>
      <FormField
        label={text.amountLabel}
        hint={`W jednostce zapasu: ${unit}. Jednostek nie przeliczamy.`}
        error={issueOf('amount') === undefined ? undefined : text.amountError}
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
      {exceedsEstimate && target.remaining !== null && (
        <p role="status" className="flex gap-2 text-sm font-medium text-warning-800">
          <Icon name="alert" className="mt-0.5 size-4" />
          <span>
            Ta ilość jest większa niż szacowany zapas ({formatAmount(target.remaining, unit)}).
            Zapiszemy ją mimo to, bo to fakt, który się wydarzył, ale zapas będzie pokazany jako
            wyczerpany. Jeśli szacunek się rozjechał, policz zapas ponownie w edycji leku.
          </span>
        </p>
      )}
      <FormField
        label="Notatka (opcjonalnie)"
        hint={`${text.noteHint} Nie wpisuj więcej danych, niż potrzebujesz. Do ${String(STOCK_EVENT_NOTE_MAX)} znaków.`}
        error={issueOf('note') === undefined ? undefined : messages['note-too-long']}
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
      {issueOf('medication') !== undefined && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {
            messages[
              issueOf('medication')?.code === 'medication-ended'
                ? 'medication-ended'
                : 'no-baseline'
            ]
          }
        </p>
      )}
    </form>
  );
}

/**
 * Changes a medication's stock by one event, in one step: the amount, an optional note, and the
 * confirmation. It serves the refill (adds) and the waste event (subtracts), through the same form
 * and the same checks (`buildRefill`, `buildWaste`). Nothing is recorded before the person
 * confirms; the event is only created from valid input. It has no unit field: the stock's own unit
 * is used and nothing is converted. A failed save keeps the form and says why.
 */
export function StockChangeDialog({
  target,
  now,
  today,
  isSaving,
  failure,
  onConfirm,
  onCancel,
}: StockChangeDialogProps) {
  const formId = useId();
  const text = target === null ? copy.refill : copy[target.kind];
  return (
    <Dialog
      open={target !== null}
      onClose={onCancel}
      title={target === null ? text.title : `${text.title}: ${target.medication.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Anuluj
          </Button>
          <Button type="submit" form={formId} isLoading={isSaving}>
            {text.submit}
          </Button>
        </>
      }
    >
      {/* Remounted for each opening, so the form starts empty and with its own event id. */}
      {target !== null && (
        <ChangeForm
          key={target.eventId}
          formId={formId}
          target={target}
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
