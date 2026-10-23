import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { DoseFeedbackMessage } from '@/features/doses/components/DoseFeedbackMessage';
import { ScheduledDoseRow } from '@/features/doses/components/ScheduledDoseRow';
import { useDoseListActions } from '@/features/doses/hooks/useDoseListActions';
import { summarizeDay } from '@/features/doses/logic/daySummary';
import { selectNextUnrecordedDose } from '@/features/doses/logic/nextDose';
import { generateScheduledDoses } from '@/features/doses/logic/scheduledDoses';
import { doseSlotKey } from '@/features/doses/logic/slots';
import type { DoseLog } from '@/features/doses/types';
import type { Medication } from '@/features/medications/types';
import type { AsyncDataResult } from '@/hooks/useAsyncData';
import type { LocalDate } from '@/types/primitives';
import { formatLocalDate } from '@/utils/format';
import { DashboardPanel } from './DashboardPanel';

interface TodayDosesPanelProps {
  medications: AsyncDataResult<Medication[]>;
  doseLogs: AsyncDataResult<DoseLog[]>;
  /** The current local day, from the injected clock and the user's time zone. */
  today: LocalDate;
  timeZone: string;
  onRetry: () => void;
}

/**
 * Today's doses, from the same logic and the same rows as the day view (`generateScheduledDoses`,
 * `ScheduledDoseRow`, the same write path), with the counts of taken, skipped and unrecorded
 * doses. Counts only: no percentage and no score. A dose with no record stays "Nie zapisano".
 * The first dose without a record is framed and labelled (`selectNextUnrecordedDose`), whatever
 * the time of day: it is a pointer to the next thing to do, not a claim that anything is late.
 */
export function TodayDosesPanel({
  medications,
  doseLogs,
  today,
  timeZone,
  onRetry,
}: TodayDosesPanelProps) {
  const actions = useDoseListActions({ onRefresh: doseLogs.reload });
  const loadError = medications.error ?? doseLogs.error;
  const isLoading = medications.isLoading || doseLogs.isLoading;

  const medicationList = medications.data;
  const logList = doseLogs.data;
  const day =
    medicationList === undefined || logList === undefined
      ? null
      : generateScheduledDoses({ medications: medicationList, doseLogs: logList, date: today });
  const summary = day === null ? null : summarizeDay(day.doses);
  const nextDose = day === null ? null : selectNextUnrecordedDose(day.doses);

  return (
    <DashboardPanel title="Dzisiejsze dawki" description={formatLocalDate(today)}>
      {isLoading && <Spinner label="Wczytywanie dzisiejszych dawek…" />}

      {loadError !== undefined && (
        <ErrorState
          title="Nie udało się wczytać dzisiejszych dawek"
          message={loadError.message}
          onRetry={onRetry}
        />
      )}

      {loadError === undefined && medicationList?.length === 0 && (
        <EmptyState
          icon="pill"
          title="Nie dodano jeszcze żadnego leku"
          description="Dodaj lek i jego godziny przyjmowania, a dzisiejsze dawki pojawią się tutaj."
          action={<ButtonLink to="/medications/new">Dodaj pierwszy lek</ButtonLink>}
        />
      )}

      {day !== null && medicationList !== undefined && medicationList.length > 0 && (
        <>
          {day.doses.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="Na dziś nie zaplanowano żadnych dawek"
              description="Żaden lek nie ma dziś godzin przyjmowania. Mogły się skończyć albo jeszcze się nie zacząć."
              action={
                <ButtonLink to="/doses" variant="secondary">
                  Przejdź do dawek
                </ButtonLink>
              }
            />
          ) : (
            <>
              {summary !== null && (
                <p className="text-base text-ink-muted">
                  Przyjęte: {String(summary.taken)}. Pominięte: {String(summary.skipped)}. Bez
                  zapisu: {String(summary.unrecorded)}. Razem dziś: {String(summary.total)}.
                </p>
              )}
              {actions.dialogs}
              <DoseFeedbackMessage
                feedback={actions.feedback}
                onDismiss={actions.dismissFeedback}
              />
              <ul className="space-y-3">
                {day.doses.map((dose) => (
                  <ScheduledDoseRow
                    key={doseSlotKey(dose)}
                    dose={dose}
                    pending={actions.pending}
                    isBusy={actions.pending !== null || doseLogs.isRefreshing}
                    canRecord
                    timeZone={timeZone}
                    focusRequest={actions.focusRequest}
                    onAction={actions.handleAction}
                    onDetails={actions.openDetails}
                    isNext={nextDose !== null && doseSlotKey(nextDose) === doseSlotKey(dose)}
                  />
                ))}
              </ul>
              <ButtonLink to="/doses" variant="secondary">
                Wszystkie dawki
              </ButtonLink>
            </>
          )}
        </>
      )}
    </DashboardPanel>
  );
}
