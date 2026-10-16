import { useCallback, useState } from 'react';
import type { FocusRequest } from '../components/ScheduledDoseRow';
import { doseSlotKey } from '../logic/slots';
import type { ScheduledDose } from '../types';
import type { DoseTarget } from '../applyDoseAction';
import { useDoseActions } from './useDoseActions';

/**
 * `useDoseActions` plus what every list of dose rows needs: the handler to give each row, and the
 * request that moves keyboard focus back to the row that was changed once its action finished.
 * Shared by the day view and the dashboard, so both behave identically.
 */
export function useDoseListActions({ onRefresh }: { onRefresh: () => void }) {
  const actions = useDoseActions({ onRefresh });
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const { perform } = actions;

  const handleAction = useCallback(
    (dose: ScheduledDose, target: DoseTarget) => {
      void perform(dose, target).then((result) => {
        if (result === 'done') {
          setFocusRequest((previous) => ({
            slotKey: doseSlotKey(dose),
            sequence: (previous?.sequence ?? 0) + 1,
          }));
        }
      });
    },
    [perform],
  );

  return { ...actions, focusRequest, handleAction };
}
