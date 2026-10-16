import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { DaySelector } from '@/features/doses/components/DaySelector';
import { IntakeRecordItem } from '@/features/doses/components/IntakeRecordItem';
import { DoseFeedbackMessage } from '@/features/doses/components/DoseFeedbackMessage';
import { ScheduledDoseRow } from '@/features/doses/components/ScheduledDoseRow';
import { useDoseListActions } from '@/features/doses/hooks/useDoseListActions';
import { useDoseLogs } from '@/features/doses/hooks/useDoseLogs';
import { summarizeDay } from '@/features/doses/logic/daySummary';
import { findOutsideScheduleReasons } from '@/features/doses/logic/history';
import { generateScheduledDoses } from '@/features/doses/logic/scheduledDoses';
import { doseSlotKey } from '@/features/doses/logic/slots';
import { StockExplanation } from '@/features/medications/components/StockExplanation';
import { StockSummary } from '@/features/medications/components/StockSummary';
import { useMedications } from '@/features/medications/hooks/useMedications';
import { estimateStock } from '@/features/medications/logic/stock';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import type { LocalDate } from '@/types/primitives';
import {
  compareLocalDates,
  EARLIEST_LOCAL_DATE,
  LATEST_LOCAL_DATE,
  parseLocalDate,
} from '@/utils/date';
import { getLocalDateInZone } from '@/utils/timeZone';

/**
 * The day view: the doses planned for one day, generated from the schedules (never stored),
 * with what the user has recorded for each. The chosen day lives in the address (`?date=`), so a
 * reload or the back button keeps it.
 */
export function DosesPage() {
  usePageTitle('Dawki');
  const { clock, timeZone } = useServices();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getLocalDateInZone(clock.now(), timeZone);

  const rawDate = searchParams.get('date');
  const parsedDate = rawDate === null ? null : parseLocalDate(rawDate);
  const date = parsedDate ?? today;
  const addressDateIgnored = rawDate !== null && parsedDate === null;
  const canRecord = compareLocalDates(date, today) <= 0;

  const medications = useMedications();
  // All records, once. The day's records, the stock estimates and (after a write) the refreshed
  // list all come from this one answer, so changing the day never has a stale request to race.
  const doseLogs = useDoseLogs(EARLIEST_LOCAL_DATE, LATEST_LOCAL_DATE, { keepDataOnReload: true });
  const actions = useDoseListActions({ onRefresh: doseLogs.reload });

  const medicationList = medications.data;
  const logList = doseLogs.data;
  const day = useMemo(
    () =>
      medicationList === undefined || logList === undefined
        ? null
        : generateScheduledDoses({ medications: medicationList, doseLogs: logList, date }),
    [medicationList, logList, date],
  );
  const outsideReasons = useMemo(
    () =>
      medicationList === undefined || day === null
        ? null
        : findOutsideScheduleReasons(medicationList, day.outsideSchedule),
    [medicationList, day],
  );

  const goToDay = (next: LocalDate) => {
    actions.dismissFeedback();
    setSearchParams(next === today ? {} : { date: next });
  };

  const reloadAll = () => {
    medications.reload();
    doseLogs.reload();
  };

  const loadError = medications.error ?? doseLogs.error;
  const isLoading = medications.isLoading || doseLogs.isLoading;

  const summary = day === null ? null : summarizeDay(day.doses);
  const medicationsOfDay =
    day === null || medicationList === undefined
      ? []
      : medicationList.filter((medication) =>
          day.doses.some((dose) => dose.medicationId === medication.id),
        );

  return (
    <>
      <PageHeader
        title="Dawki"
        description="Dawki zaplanowane na wybrany dzień. Zapisujesz tylko to, co faktycznie się stało; dawka bez zapisu nie jest uznawana ani za przyjętą, ani za pominiętą."
        actions={
          <ButtonLink to="/doses/history" variant="secondary">
            Historia przyjmowania
          </ButtonLink>
        }
      />

      <div className="space-y-6">
        <DaySelector date={date} today={today} onChange={goToDay} />

        {addressDateIgnored && (
          <p className="rounded-card border border-line bg-surface p-3 text-sm text-ink-muted">
            Data w adresie strony jest nieprawidłowa, więc pokazano dzisiejszy dzień.
          </p>
        )}

        <DoseFeedbackMessage feedback={actions.feedback} onDismiss={actions.dismissFeedback} />

        {!canRecord && (
          <p className="flex items-start gap-3 rounded-card border border-line bg-surface p-4 text-ink-muted">
            <Icon name="info" className="mt-0.5" />
            <span>
              To dzień w przyszłości. Dawek z przyszłych dni nie można zapisać; zrobisz to, gdy
              dzień nadejdzie.
            </span>
          </p>
        )}

        {isLoading && <Spinner label="Wczytywanie dawek…" />}

        {loadError !== undefined && (
          <ErrorState
            title="Nie udało się wczytać dawek"
            message={loadError.message}
            onRetry={reloadAll}
          />
        )}

        {medicationList?.length === 0 && (
          <EmptyState
            icon="pill"
            title="Nie dodano jeszcze żadnego leku"
            description="Dodaj lek i jego godziny przyjmowania, a zaplanowane dawki pojawią się tutaj."
            action={<ButtonLink to="/medications/new">Dodaj pierwszy lek</ButtonLink>}
          />
        )}

        {day !== null && medicationList !== undefined && medicationList.length > 0 && (
          <>
            {day.doses.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="Brak zaplanowanych dawek tego dnia"
                description="Żaden lek nie ma w tym dniu godzin przyjmowania. Mogły się skończyć albo jeszcze się nie zacząć."
              />
            ) : (
              <section aria-labelledby="doses-heading" className="space-y-3">
                <h2 id="doses-heading" className="text-lg font-semibold">
                  Zaplanowane dawki ({String(day.doses.length)})
                </h2>
                {summary !== null && (
                  <p className="text-sm text-ink-muted">
                    Przyjęte: {String(summary.taken)}. Pominięte: {String(summary.skipped)}. Bez
                    zapisu: {String(summary.unrecorded)}.
                  </p>
                )}
                <ul className="space-y-3">
                  {day.doses.map((dose) => (
                    <ScheduledDoseRow
                      key={doseSlotKey(dose)}
                      dose={dose}
                      pending={actions.pending}
                      isBusy={actions.pending !== null || doseLogs.isRefreshing}
                      canRecord={canRecord}
                      timeZone={timeZone}
                      focusRequest={actions.focusRequest}
                      onAction={actions.handleAction}
                    />
                  ))}
                </ul>
              </section>
            )}

            {day.outsideSchedule.length > 0 && (
              <section aria-labelledby="outside-heading" className="space-y-3">
                <h2 id="outside-heading" className="text-lg font-semibold">
                  Wpisy poza aktualnym harmonogramem ({String(day.outsideSchedule.length)})
                </h2>
                <p className="text-sm text-ink-muted">
                  Te zapisy dotyczą tego dnia, ale obecny harmonogram nie planuje już takich dawek.
                  Zostają w historii bez zmian i nie można ich tu zmienić ani zapisać ponownie.
                  Błędny zapis możesz usunąć w historii przyjmowania.
                </p>
                <ButtonLink to={`/doses/history?from=${date}&to=${date}`} variant="secondary">
                  Zobacz te zapisy w historii
                </ButtonLink>
                <ul className="space-y-3">
                  {day.outsideSchedule.map((log) => (
                    <IntakeRecordItem
                      key={log.id}
                      log={log}
                      medication={medicationList.find(
                        (medication) => medication.id === log.medicationId,
                      )}
                      outsideReason={outsideReasons?.get(log.id) ?? null}
                      timeZone={timeZone}
                    />
                  ))}
                </ul>
              </section>
            )}

            {medicationsOfDay.length > 0 && logList !== undefined && (
              <section aria-labelledby="stock-heading" className="space-y-3">
                <h2 id="stock-heading" className="text-lg font-semibold">
                  Szacunkowy zapas (stan na dziś)
                </h2>
                <ul className="space-y-2">
                  {medicationsOfDay.map((medication) => (
                    <li
                      key={medication.id}
                      className="rounded-card border border-line bg-surface p-4"
                    >
                      <p className="break-words font-medium">{medication.name}</p>
                      <p className="text-sm text-ink-muted">
                        <StockSummary
                          estimate={estimateStock({ medication, doseLogs: logList, today })}
                        />
                      </p>
                    </li>
                  ))}
                </ul>
                <StockExplanation />
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
