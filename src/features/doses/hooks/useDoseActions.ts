import { useCallback, useState } from 'react';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useServices } from '@/hooks/useServices';
import { formatAmount } from '@/features/medications/logic/unitForms';
import {
  applyDoseAction,
  applyTakenDetails,
  doseActionErrorMessages,
  isConflictRepositoryError,
  isStaleScreenError,
  type DoseActionOutcome,
  type DoseTarget,
} from '../applyDoseAction';
import type { TakenDetails } from '../logic/recording';
import { doseSlotKey } from '../logic/slots';
import type { DoseLog, ScheduledDose } from '../types';

/** The one write in flight: which slot, and what was asked for. */
export interface PendingDoseAction {
  slotKey: string;
  /** `details` is the dialog that records the amount actually taken and a note. */
  target: DoseTarget | 'details';
}

/** How the dialog for the amount actually taken and the note ended. */
export type DetailsResult =
  /** Another write was running: nothing started. */
  | { status: 'ignored' }
  /** Written (or already as asked). The dialog closes. */
  | { status: 'saved' }
  /** The screen was out of date: nothing was written, the page was refreshed and says so. The dialog closes. */
  | { status: 'stale' }
  /** Not written; the reason is for the dialog, which stays open with what was typed. */
  | { status: 'failed'; message: string };

/** The sentence that says both amounts, so the plan and what was taken are never confused. */
function amountsSentence(log: DoseLog): string {
  const planned = formatAmount(log.doseAmount, log.doseUnit);
  return log.takenAmount === undefined
    ? `Przyjęto zgodnie z planem: ${planned}.`
    : `Przyjęto ${formatAmount(log.takenAmount, log.doseUnit)}, planowano ${planned}.`;
}

/** The honest outcome of the last action. A success is only ever set after the write finished. */
export type DoseFeedback =
  { kind: 'success'; message: string } | { kind: 'error'; title: string; message: string };

function successMessage(dose: ScheduledDose, outcome: Extract<DoseActionOutcome, { ok: true }>) {
  const label = `${dose.medicationName}, ${dose.time}`;
  switch (outcome.change) {
    case 'created':
      return outcome.log?.status === 'skipped'
        ? `Zapisano jako pominiętą: ${label}.`
        : outcome.log?.takenAmount === undefined
          ? `Zapisano jako przyjętą: ${label}.`
          : `Zapisano jako przyjętą: ${label}. ${amountsSentence(outcome.log)}`;
    case 'updated':
      return `Zmieniono zapis: ${label} — teraz ${outcome.log?.status === 'skipped' ? 'pominięta' : 'przyjęta'}.`;
    case 'unchanged':
      return `Ta dawka miała już taki zapis: ${label}. Nic nie zmieniono.`;
    case 'removed':
      return `Cofnięto zapis: ${label}. Dawka jest znów bez zapisu.`;
    case 'none':
      return `Ta dawka nie miała zapisu: ${label}. Nic nie zmieniono.`;
  }
}

/**
 * Records, changes and clears doses, one write at a time.
 *
 * - While a write is running every other `perform` is ignored (a double click, or a click on
 *   another dose, cannot start a second write), and `pending` says which one is running so the
 *   screen can disable the buttons and show progress.
 * - `feedback` is set only when the write has finished: success after the repository accepted it,
 *   an error after it was refused or failed. A failed write never leaves a success message.
 * - `onRefresh` is called when the screen should load the data again: after a write that went
 *   through, and after a refusal that means the screen was out of date. After a plain storage
 *   failure nothing was written, so nothing is reloaded.
 * - `perform` returns `'ignored'` when it did not start, `'done'` otherwise (success or failure).
 */
export function useDoseActions({ onRefresh }: { onRefresh: () => void }) {
  const { repositories, clock, timeZone, createId } = useServices();
  const action = useAsyncAction();
  const [pending, setPending] = useState<PendingDoseAction | null>(null);
  const [feedback, setFeedback] = useState<DoseFeedback | null>(null);
  const { run } = action;

  const perform = useCallback(
    async (dose: ScheduledDose, target: DoseTarget): Promise<'done' | 'ignored'> => {
      const outcome = await run(() => {
        setPending({ slotKey: doseSlotKey(dose), target });
        setFeedback(null);
        return applyDoseAction({
          repositories,
          dose,
          target,
          now: clock.now(),
          timeZone,
          createId,
        });
      });
      // An ignored click (a write is already running) must not clear that write's progress
      // indicator, so the pending state is only cleared by the run that set it.
      if (outcome.status === 'ignored') return 'ignored';
      setPending(null);

      if (outcome.status === 'failed') {
        setFeedback({
          kind: 'error',
          title: 'Nie zapisano zmiany',
          message: outcome.error.message,
        });
        if (isConflictRepositoryError(outcome.error)) onRefresh();
        return 'done';
      }

      const result = outcome.value;
      if (result.ok) {
        setFeedback({ kind: 'success', message: successMessage(dose, result) });
        onRefresh();
      } else {
        setFeedback({
          kind: 'error',
          title: 'Nie zapisano zmiany',
          message: doseActionErrorMessages[result.error],
        });
        if (isStaleScreenError(result.error)) onRefresh();
      }
      return 'done';
    },
    [run, repositories, clock, timeZone, createId, onRefresh],
  );

  /**
   * Records a dose as taken with the amount actually taken and a note, or edits those on a taken
   * dose (see `applyTakenDetails`). Shares the single write slot with `perform`.
   */
  const performDetails = useCallback(
    async (dose: ScheduledDose, details: TakenDetails): Promise<DetailsResult> => {
      const outcome = await run(() => {
        setPending({ slotKey: doseSlotKey(dose), target: 'details' });
        setFeedback(null);
        return applyTakenDetails({
          repositories,
          dose,
          details,
          now: clock.now(),
          timeZone,
          createId,
        });
      });
      if (outcome.status === 'ignored') return { status: 'ignored' };
      setPending(null);

      if (outcome.status === 'failed') {
        if (isConflictRepositoryError(outcome.error)) onRefresh();
        return { status: 'failed', message: outcome.error.message };
      }
      const result = outcome.value;
      if (result.ok) {
        const label = `${dose.medicationName}, ${dose.time}`;
        setFeedback({
          kind: 'success',
          message:
            result.change === 'unchanged'
              ? `Ta dawka miała już taki zapis: ${label}. Nic nie zmieniono.`
              : result.change === 'created'
                ? successMessage(dose, result)
                : `Zapisano zmiany: ${label}. ${result.log === null ? '' : amountsSentence(result.log)}`,
        });
        onRefresh();
        return { status: 'saved' };
      }
      if (isStaleScreenError(result.error)) {
        setFeedback({
          kind: 'error',
          title: 'Nie zapisano zmiany',
          message: doseActionErrorMessages[result.error],
        });
        onRefresh();
        return { status: 'stale' };
      }
      return { status: 'failed', message: doseActionErrorMessages[result.error] };
    },
    [run, repositories, clock, timeZone, createId, onRefresh],
  );

  const dismissFeedback = useCallback(() => {
    setFeedback(null);
  }, []);

  return { perform, performDetails, pending, feedback, dismissFeedback };
}
