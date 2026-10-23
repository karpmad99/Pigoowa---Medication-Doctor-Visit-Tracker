import { useCallback, useState, type ReactNode } from 'react';
import { TakenAmountDialog } from '../components/TakenAmountDialog';
import type { FocusRequest } from '../components/ScheduledDoseRow';
import { doseSlotKey } from '../logic/slots';
import type { ScheduledDose } from '../types';
import type { DoseTarget } from '../applyDoseAction';
import { useDoseActions } from './useDoseActions';

/**
 * `useDoseActions` plus what every list of dose rows needs: the handler to give each row, the
 * request that moves keyboard focus back to the row that was changed once its action finished, and
 * the dialog for the amount actually taken and the note (`openDetails`, rendered through `dialogs`).
 * Shared by the day view and the dashboard, so both behave identically.
 */
export function useDoseListActions({ onRefresh }: { onRefresh: () => void }) {
  const actions = useDoseActions({ onRefresh });
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<ScheduledDose | null>(null);
  const { perform, performDetails } = actions;

  const requestFocus = useCallback((dose: ScheduledDose) => {
    setFocusRequest((previous) => ({
      slotKey: doseSlotKey(dose),
      sequence: (previous?.sequence ?? 0) + 1,
    }));
  }, []);

  const handleAction = useCallback(
    (dose: ScheduledDose, target: DoseTarget) => {
      void perform(dose, target).then((result) => {
        if (result === 'done') requestFocus(dose);
      });
    },
    [perform, requestFocus],
  );

  const openDetails = useCallback(
    (dose: ScheduledDose) => {
      actions.dismissFeedback();
      setDetailsTarget(dose);
    },
    [actions],
  );

  const dialogs: ReactNode = (
    <TakenAmountDialog
      dose={detailsTarget}
      isSaving={actions.pending?.target === 'details'}
      onSubmit={async (dose, details) => {
        const result = await performDetails(dose, details);
        if (result.status === 'saved' || result.status === 'stale') requestFocus(dose);
        return result;
      }}
      onClose={() => {
        setDetailsTarget(null);
      }}
    />
  );

  return { ...actions, focusRequest, handleAction, openDetails, dialogs };
}
