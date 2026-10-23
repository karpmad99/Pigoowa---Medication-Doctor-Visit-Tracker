import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatAmount } from '@/features/medications/logic/unitForms';
import type { Medication } from '@/features/medications/types';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useServices } from '@/hooks/useServices';
import { isRollbackFailure } from '@/services/errors';
import { getLocalDateInZone } from '@/utils/timeZone';
import { StockChangeDialog, type StockChangeTarget } from '../components/StockChangeDialog';
import { StartTrackingDialog } from '../components/StartTrackingDialog';
import type { StockEvent } from '../types';

interface ReverseTarget {
  event: StockEvent;
  medicationName: string;
}

export interface StockActions {
  /** Opens the refill dialog for a medication that has a stock. */
  openRefill: (medication: Medication) => void;
  /**
   * Opens the waste dialog for a medication that has a stock. `remaining` is the estimated amount
   * now (or `null`), only used to warn when the lost amount is larger than that.
   */
  openWaste: (medication: Medication, remaining: number | null) => void;
  /** Opens "Zacznij śledzić zapas" for a medication that has none. */
  openStart: (medication: Medication) => void;
  /** Asks for confirmation to reverse an event. */
  openReverse: (event: StockEvent, medicationName: string) => void;
  /** What the last action did, in words, or `null`. */
  feedback: string | null;
  dismissFeedback: () => void;
  /** True while a write is in flight. */
  isBusy: boolean;
  /** The dialogs; render them once on the page. */
  dialogs: ReactNode;
}

/**
 * The three stock actions (refill, start tracking, reverse) with their dialogs, shared by the
 * screens that offer them. One write at a time; a failed write keeps the dialog open with the
 * reason; a successful one closes it, says what happened and calls `onChanged` so the page loads
 * the new state (the estimate and the warnings are recomputed from what is stored).
 */
export function useStockActions({ onChanged }: { onChanged: () => void }): StockActions {
  const { clock, timeZone, createId, repositories } = useServices();
  const action = useAsyncAction();
  const [changeTarget, setChangeTarget] = useState<StockChangeTarget | null>(null);
  const [startTarget, setStartTarget] = useState<Medication | null>(null);
  const [reverseTarget, setReverseTarget] = useState<ReverseTarget | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const today = getLocalDateInZone(clock.now(), timeZone);

  const close = () => {
    setChangeTarget(null);
    setStartTarget(null);
    setReverseTarget(null);
    action.clearError();
  };

  const confirmChange = async (event: StockEvent) => {
    if (changeTarget === null) return;
    const { medication } = changeTarget;
    const outcome = await action.run(() => repositories.stockEvents.append(event));
    if (outcome.status !== 'success') return;
    const amount = formatAmount(event.amount, event.unit);
    setFeedback(
      event.kind === 'refill'
        ? `Uzupełniono zapas leku „${medication.name}”: dodano ${amount}.`
        : `Zapisano stratę leku „${medication.name}”: odjęto ${amount} od zapasu. To nie jest zapis przyjęcia dawki.`,
    );
    close();
    onChanged();
  };

  const confirmStart = async (updated: Medication) => {
    const outcome = await action.run(() => repositories.medications.update(updated));
    if (outcome.status !== 'success') return;
    const stock = updated.stock;
    const amount = stock === null ? '' : formatAmount(stock.quantity, stock.unit);
    setFeedback(
      stock?.basis === 'new-package'
        ? `Zaczęto śledzić zapas leku „${updated.name}” od nowego opakowania: ${amount}. Wcześniejszej pozostałości nie uwzględniamy.`
        : `Zaczęto śledzić zapas leku „${updated.name}”: policzono ${amount}.`,
    );
    close();
    onChanged();
  };

  const confirmReverse = async () => {
    if (reverseTarget === null) return;
    const { event, medicationName } = reverseTarget;
    const outcome = await action.run(() => repositories.stockEvents.reverse(event.id, clock.now()));
    if (outcome.status !== 'success') return;
    setFeedback(
      `Cofnięto zdarzenie zapasu leku „${medicationName}”: ${formatAmount(event.amount, event.unit)}. Zdarzenie zostaje w historii i nie zmienia szacunku.`,
    );
    close();
    onChanged();
  };

  return {
    openRefill: (medication) => {
      setFeedback(null);
      action.clearError();
      setChangeTarget({ kind: 'refill', medication, eventId: createId(), remaining: null });
    },
    openWaste: (medication, remaining) => {
      setFeedback(null);
      action.clearError();
      setChangeTarget({ kind: 'waste', medication, eventId: createId(), remaining });
    },
    openStart: (medication) => {
      setFeedback(null);
      action.clearError();
      setStartTarget(medication);
    },
    openReverse: (event, medicationName) => {
      setFeedback(null);
      action.clearError();
      setReverseTarget({ event, medicationName });
    },
    feedback,
    dismissFeedback: () => {
      setFeedback(null);
    },
    isBusy: action.isRunning,
    dialogs: (
      <>
        <StockChangeDialog
          target={changeTarget}
          now={() => clock.now()}
          today={today}
          isSaving={action.isRunning}
          failure={changeTarget === null ? null : action.error}
          onConfirm={(event) => {
            void confirmChange(event);
          }}
          onCancel={close}
        />
        <StartTrackingDialog
          medication={startTarget}
          now={() => clock.now()}
          today={today}
          isSaving={action.isRunning}
          failure={startTarget === null ? null : action.error}
          onConfirm={(updated) => {
            void confirmStart(updated);
          }}
          onCancel={close}
        />
        <ConfirmDialog
          open={reverseTarget !== null}
          title={
            reverseTarget === null
              ? 'Cofnąć zdarzenie?'
              : `Cofnąć zdarzenie zapasu leku „${reverseTarget.medicationName}”?`
          }
          confirmLabel="Cofnij zdarzenie"
          isConfirming={action.isRunning}
          onConfirm={() => {
            void confirmReverse();
          }}
          onCancel={close}
        >
          <p>
            Zdarzenie przestanie być wliczane w szacunek zapasu, ale zostanie w historii jako
            cofnięte. Tego nie da się odwrócić.
          </p>
          {reverseTarget !== null && action.error !== null && (
            <p role="alert" className="mt-3 text-sm font-medium text-danger-700">
              {action.error.message}
              {isRollbackFailure(action.error) &&
                ' Dane mogą być niespójne: odśwież stronę i sprawdź zapas leku.'}
            </p>
          )}
        </ConfirmDialog>
      </>
    ),
  };
}
