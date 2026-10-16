import type { Medication } from '@/features/medications/types';
import { formatLocalDay } from '@/utils/format';
import type { OutsideScheduleReason } from './logic/history';

/** Why a record is outside the current schedule, in plain Polish. Only states what is certain. */
export function outsideScheduleExplanation(
  reason: OutsideScheduleReason,
  medication: Medication | undefined,
): string {
  switch (reason) {
    case 'medication-removed':
      return 'Ten lek został usunięty, a jego zapis pozostał.';
    case 'before-start':
      return 'Zapis dotyczy dnia sprzed daty rozpoczęcia leku.';
    case 'after-end':
      return 'Zapis dotyczy dnia po zakończeniu leku.';
    case 'before-schedule-change':
      return medication === undefined
        ? 'Zapis pochodzi sprzed zmiany harmonogramu.'
        : `Zapis pochodzi sprzed zmiany harmonogramu. Obecny obowiązuje od ${formatLocalDay(medication.scheduleEffectiveFrom)}.`;
    case 'time-not-in-schedule':
      return 'Obecny harmonogram nie ma dawki o tej godzinie.';
  }
}
