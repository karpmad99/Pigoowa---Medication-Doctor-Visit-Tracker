import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField } from '@/components/ui/FormField';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { IntakeRecordItem } from '@/features/doses/components/IntakeRecordItem';
import {
  deleteOutsideScheduleRecord,
  deleteRecordRefusalMessages,
} from '@/features/doses/deleteIntakeRecord';
import { useDoseLogs } from '@/features/doses/hooks/useDoseLogs';
import {
  filterHistory,
  findOutsideScheduleReasons,
  groupByDate,
  isRangeReversed,
  sortHistory,
  type OutsideScheduleReason,
} from '@/features/doses/logic/history';
import { parseHistoryFilters } from '@/features/doses/logic/historyFilters';
import { outsideScheduleExplanation } from '@/features/doses/outsideScheduleText';
import { doseStatusLabel } from '@/features/doses/statusLabels';
import type { DoseLog } from '@/features/doses/types';
import { formatAmount } from '@/features/medications/logic/unitForms';
import type { Medication } from '@/features/medications/types';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useMedications } from '@/features/medications/hooks/useMedications';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { EARLIEST_LOCAL_DATE, LATEST_LOCAL_DATE } from '@/utils/date';
import { formatLocalDate, formatLocalDay, pluralize } from '@/utils/format';

const recordsWord = { one: 'zapis', few: 'zapisy', many: 'zapisów' };

type FilterKey = 'from' | 'to' | 'medication' | 'status';

/** The record the user asked to delete, with the medication it belongs to (gone for a deleted one). */
interface DeletionTarget {
  log: DoseLog;
  medication: Medication | undefined;
}

/**
 * The intake history: only what was recorded (taken or skipped), never the doses that were merely
 * planned. Filters live in the address, so a reload or the back button keeps them. The records
 * are loaded once; filtering happens in memory, so changing a filter cannot show a late answer.
 *
 * A record that lies outside the current schedule cannot be corrected in the day view, so the
 * history offers to delete exactly that record, behind a confirmation (`deleteOutsideScheduleRecord`).
 */
export function DoseHistoryPage() {
  usePageTitle('Historia przyjmowania');
  const { timeZone, repositories } = useServices();
  const [searchParams, setSearchParams] = useSearchParams();
  const medications = useMedications();
  const doseLogs = useDoseLogs(EARLIEST_LOCAL_DATE, LATEST_LOCAL_DATE, { keepDataOnReload: true });
  const action = useAsyncAction();
  const [deleteTarget, setDeleteTarget] = useState<DeletionTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  // After a deletion the button that was pressed is gone, so focus goes to the results heading.
  // It waits for the refresh that follows the deletion: the list (or, if that was the last
  // record, the whole view) is replaced when the new data arrives, and focus must not be left on
  // something that is about to disappear.
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPending = useRef(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const isRefreshing = doseLogs.isRefreshing;
  useEffect(() => {
    if (!focusPending.current || isRefreshing) return;
    focusPending.current = false;
    (resultsHeadingRef.current ?? document.getElementById('main-content'))?.focus();
  }, [focusRequest, isRefreshing]);

  const medicationList = medications.data;
  const logList = doseLogs.data;

  const parsed = useMemo(
    () =>
      medicationList === undefined
        ? null
        : parseHistoryFilters(
            {
              from: searchParams.get('from'),
              to: searchParams.get('to'),
              medication: searchParams.get('medication'),
              status: searchParams.get('status'),
            },
            new Set(medicationList.map((medication) => medication.id)),
          ),
    [medicationList, searchParams],
  );

  const view = useMemo(() => {
    if (medicationList === undefined || logList === undefined || parsed === null) return null;
    const names = new Map(medicationList.map((medication) => [medication.id, medication.name]));
    const filtered = filterHistory(logList, parsed.filters);
    const sorted = sortHistory(filtered, (id) => names.get(id) ?? '');
    return {
      count: sorted.length,
      days: groupByDate(sorted),
      reasons: findOutsideScheduleReasons(medicationList, sorted),
    };
  }, [medicationList, logList, parsed]);

  const setFilter = (key: FilterKey, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => {
    setSearchParams({}, { replace: true });
  };

  const reloadAll = () => {
    medications.reload();
    doseLogs.reload();
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
    action.clearError();
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const { log, medication } = deleteTarget;
    const outcome = await action.run(() => deleteOutsideScheduleRecord({ repositories, log }));
    if (outcome.status !== 'success') return; // a storage failure stays in the dialog (action.error)

    if (outcome.value.ok) {
      setProblem(null);
      setNotice(
        `Usunięto zapis: ${medication?.name ?? 'Usunięty lek'}, ${formatLocalDay(log.scheduledDate)}, ${log.scheduledTime}.`,
      );
    } else {
      setNotice(null);
      setProblem({
        title: 'Nie usunięto zapisu',
        message: deleteRecordRefusalMessages[outcome.value.error],
      });
    }
    closeDeleteDialog();
    doseLogs.reload();
    focusPending.current = true;
    setFocusRequest((previous) => previous + 1);
  };
  const loadError = medications.error ?? doseLogs.error;
  const isLoading = medications.isLoading || doseLogs.isLoading;
  // What counts is what is applied, not what the address says: an ignored value filters nothing.
  const hasActiveFilters =
    parsed !== null && Object.values(parsed.filters).some((value) => value !== null);
  const reversed = parsed !== null && isRangeReversed(parsed.filters);

  return (
    <>
      <PageHeader
        title="Historia przyjmowania"
        description="Zapisy dawek oznaczonych jako przyjęte lub pominięte. Dawki zaplanowane, ale niezapisane, nie są tu pokazywane."
        actions={
          <ButtonLink to="/doses" variant="secondary">
            Widok dnia
          </ButtonLink>
        }
      />

      <div role="status" aria-live="polite">
        {notice !== null && (
          <p className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-card border border-success-800 bg-success-50 p-4 text-success-800">
            <Icon name="check" className="mt-0.5" />
            <span className="min-w-0 flex-1 basis-48 font-medium">{notice}</span>
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 text-success-800"
              onClick={() => {
                setNotice(null);
              }}
            >
              Zamknij komunikat
            </Button>
          </p>
        )}
      </div>
      {problem !== null && (
        <div className="mb-4">
          <ErrorState title={problem.title} message={problem.message} />
        </div>
      )}

      {isLoading && <Spinner label="Wczytywanie historii…" />}

      {loadError !== undefined && (
        <ErrorState
          title="Nie udało się wczytać historii"
          message={loadError.message}
          onRetry={reloadAll}
        />
      )}

      {medicationList !== undefined &&
        logList !== undefined &&
        parsed !== null &&
        view !== null && (
          <div className="space-y-6">
            {logList.length === 0 ? (
              <EmptyState
                icon="check"
                title="Historia jest pusta"
                description="Zapisy pojawią się tutaj, gdy oznaczysz dawkę jako przyjętą lub pominiętą."
                action={<ButtonLink to="/doses">Przejdź do dawek</ButtonLink>}
              />
            ) : (
              <>
                <fieldset className="rounded-card border border-line bg-surface p-4">
                  <legend className="px-1 text-base font-semibold">Filtry</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      label="Od dnia"
                      error={reversed ? 'Data początkowa jest późniejsza niż końcowa.' : undefined}
                    >
                      {(control) => (
                        <Input
                          {...control}
                          type="date"
                          min={EARLIEST_LOCAL_DATE}
                          max={LATEST_LOCAL_DATE}
                          value={parsed.filters.from ?? ''}
                          onChange={(event) => {
                            setFilter('from', event.target.value);
                          }}
                        />
                      )}
                    </FormField>
                    <FormField label="Do dnia">
                      {(control) => (
                        <Input
                          {...control}
                          type="date"
                          min={EARLIEST_LOCAL_DATE}
                          max={LATEST_LOCAL_DATE}
                          value={parsed.filters.to ?? ''}
                          onChange={(event) => {
                            setFilter('to', event.target.value);
                          }}
                        />
                      )}
                    </FormField>
                    <FormField label="Lek">
                      {(control) => (
                        <Select
                          {...control}
                          value={parsed.filters.medicationId ?? ''}
                          onChange={(event) => {
                            setFilter('medication', event.target.value);
                          }}
                        >
                          <option value="">Wszystkie leki</option>
                          {medicationList.map((medication) => (
                            <option key={medication.id} value={medication.id}>
                              {medication.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                    <FormField label="Status">
                      {(control) => (
                        <Select
                          {...control}
                          value={parsed.filters.status ?? ''}
                          onChange={(event) => {
                            setFilter('status', event.target.value);
                          }}
                        >
                          <option value="">Wszystkie statusy</option>
                          <option value="taken">Przyjęte</option>
                          <option value="skipped">Pominięte</option>
                        </Select>
                      )}
                    </FormField>
                  </div>
                  <div className="mt-4">
                    <Button variant="secondary" onClick={clearFilters}>
                      Wyczyść filtry
                    </Button>
                  </div>
                </fieldset>

                {parsed.ignoredInvalid && (
                  <p className="rounded-card border border-line bg-surface p-3 text-sm text-ink-muted">
                    Pominięto nieprawidłowe filtry z adresu strony.
                  </p>
                )}

                <h2
                  ref={resultsHeadingRef}
                  tabIndex={-1}
                  className="rounded-control text-lg font-semibold focus:outline-2 focus:outline-offset-2 focus:outline-brand-600"
                  aria-live="polite"
                >
                  {view.count === 0
                    ? 'Brak zapisów'
                    : `Znaleziono ${String(view.count)} ${pluralize(view.count, recordsWord)}`}
                  {hasActiveFilters && view.count > 0 && ' dla wybranych filtrów'}
                </h2>

                {view.count === 0 ? (
                  <EmptyState
                    icon="info"
                    title="Brak zapisów dla wybranych filtrów"
                    description={
                      reversed
                        ? 'Data początkowa jest późniejsza niż końcowa, więc żaden zapis nie pasuje. Popraw daty albo wyczyść filtry.'
                        : 'Żaden zapis nie pasuje do wybranych dat, leku i statusu. Zmień filtry albo wyczyść je, aby zobaczyć całą historię.'
                    }
                    action={
                      <Button variant="secondary" onClick={clearFilters}>
                        Wyczyść filtry
                      </Button>
                    }
                  />
                ) : (
                  <div className="space-y-6">
                    <p className="text-sm text-ink-muted">
                      Najnowsze dni są na górze, a w ciągu dnia zapisy idą od najwcześniejszej
                      godziny.
                    </p>
                    {view.days.map((day) => (
                      <section
                        key={day.date}
                        aria-labelledby={`day-${day.date}`}
                        className="space-y-3"
                      >
                        <h3 id={`day-${day.date}`} className="font-semibold">
                          {formatLocalDate(day.date)}
                        </h3>
                        <ul className="space-y-3">
                          {day.logs.map((log) => {
                            const medication = medicationList.find(
                              (candidate) => candidate.id === log.medicationId,
                            );
                            const outsideReason = view.reasons.get(log.id) ?? null;
                            const name = medication?.name ?? 'Usunięty lek';
                            return (
                              <IntakeRecordItem
                                key={log.id}
                                log={log}
                                medication={medication}
                                outsideReason={outsideReason}
                                timeZone={timeZone}
                                // Only a record outside the current schedule can be deleted here: one that
                                // matches it is corrected in the day view.
                                actions={
                                  outsideReason === null ? undefined : (
                                    <Button
                                      variant="dangerOutline"
                                      aria-label={`Usuń zapis…: ${name}, ${formatLocalDay(log.scheduledDate)}, ${log.scheduledTime}`}
                                      onClick={() => {
                                        setNotice(null);
                                        setProblem(null);
                                        setDeleteTarget({ log, medication });
                                      }}
                                    >
                                      <Icon name="alert" className="size-4" />
                                      Usuń zapis…
                                    </Button>
                                  )
                                }
                              />
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        title="Usunąć ten zapis z historii?"
        confirmLabel="Usuń zapis"
        isConfirming={action.isRunning}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={closeDeleteDialog}
      >
        {deleteTarget !== null && (
          <>
            <p>
              <strong className="break-words text-ink">
                {deleteTarget.medication?.name ?? 'Usunięty lek'}
              </strong>
              , {formatLocalDay(deleteTarget.log.scheduledDate)}, {deleteTarget.log.scheduledTime}:{' '}
              {doseStatusLabel(deleteTarget.log.status).toLowerCase()},{' '}
              {formatAmount(deleteTarget.log.doseAmount, deleteTarget.log.doseUnit)}.
            </p>
            <p>
              Zapis jest poza aktualnym harmonogramem.{' '}
              {outsideReasonText(deleteTarget, view?.reasons)}
            </p>
            <p>
              Zapis zostanie <strong className="text-ink">trwale usunięty</strong> z historii. Tej
              operacji nie można cofnąć. Harmonogram i inne zapisy pozostaną bez zmian. Jeśli zapis
              oznaczał przyjętą dawkę, szacunkowy zapas leku może się zwiększyć.
            </p>
            {action.error !== null && (
              <p
                role="alert"
                className="rounded-control border border-danger-600 bg-danger-50 p-3 text-sm font-medium text-danger-700"
              >
                Nie usunięto zapisu. {action.error.message}
              </p>
            )}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}

function outsideReasonText(
  target: DeletionTarget,
  reasons: ReadonlyMap<string, OutsideScheduleReason> | undefined,
): string {
  const reason = reasons?.get(target.log.id);
  return reason === undefined ? '' : outsideScheduleExplanation(reason, target.medication);
}
