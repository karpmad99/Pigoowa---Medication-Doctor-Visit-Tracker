import { useCallback, useState } from 'react';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useServices } from '@/hooks/useServices';
import {
  applyDoseAction,
  doseActionErrorMessages,
  isConflictRepositoryError,
  isStaleScreenError,
  type DoseActionOutcome,
  type DoseTarget,
} from '../applyDoseAction';
import { doseSlotKey } from '../logic/slots';
import type { ScheduledDose } from '../types';

/** The one write in flight: which slot, and what was asked for. */
export interface PendingDoseAction {
  slotKey: string;
  target: DoseTarget;
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
        : `Zapisano jako przyjętą: ${label}.`;
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

  const dismissFeedback = useCallback(() => {
    setFeedback(null);
  }, []);

  return { perform, pending, feedback, dismissFeedback };
}
