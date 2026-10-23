import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { readFlashNotice } from '@/app/flashNotice';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { useDoseLogs } from '@/features/doses/hooks/useDoseLogs';
import { EndMedicationDialog } from '@/features/medications/components/EndMedicationDialog';
import { MedicationCard } from '@/features/medications/components/MedicationCard';
import { useMedications } from '@/features/medications/hooks/useMedications';
import { StockFeedback } from '@/features/stock/components/StockFeedback';
import { useStockActions } from '@/features/stock/hooks/useStockActions';
import { useStockEvents } from '@/features/stock/hooks/useStockEvents';
import { endMedication } from '@/features/medications/logic/endMedication';
import { getMedicationStatus } from '@/features/medications/logic/status';
import { estimateStock, type StockEstimate } from '@/features/medications/logic/stock';
import type { Medication } from '@/features/medications/types';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { isRollbackFailure } from '@/services/errors';
import {
  compareLocalDates,
  EARLIEST_LOCAL_DATE,
  LATEST_LOCAL_DATE,
  parseLocalDate,
} from '@/utils/date';
import { pluralize } from '@/utils/format';
import { getLocalDateInZone } from '@/utils/timeZone';

interface DeletionTarget {
  medication: Medication;
  /** How many intake records will be destroyed with it, counted before asking for confirmation. */
  historyCount: number;
  /** How many stock events (refills, waste) will be destroyed with it. */
  stockEventCount: number;
}

const recordsWord = { one: 'zapis', few: 'zapisy', many: 'zapisów' };
const eventsWord = { one: 'zdarzenie', few: 'zdarzenia', many: 'zdarzeń' };

/** The medications: list, and the entry points to add, edit, end and delete. */
export function MedicationsPage() {
  usePageTitle('Leki');
  const { clock, timeZone, repositories } = useServices();
  const location = useLocation();
  const navigate = useNavigate();
  const medications = useMedications();
  // The intake history is loaded too, only because the stock estimate is computed from it.
  const doseLogs = useDoseLogs(EARLIEST_LOCAL_DATE, LATEST_LOCAL_DATE);
  // And the stock events (refills, waste), which the estimate adds to and subtracts from the stock.
  const stockEvents = useStockEvents();
  const action = useAsyncAction();
  const today = getLocalDateInZone(clock.now(), timeZone);

  const [notice, setNotice] = useState<string | null>(() => readFlashNotice(location.state));
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const [endTarget, setEndTarget] = useState<Medication | null>(null);
  const [endDateError, setEndDateError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeletionTarget | null>(null);

  // The message from the previous page was kept in `notice` above; remove it from the history
  // entry so that reloading the page does not show it again.
  useEffect(() => {
    if (location.state !== null) {
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  const reloadAll = () => {
    medications.reload();
    doseLogs.reload();
    stockEvents.reload();
  };
  const stockActions = useStockActions({ onChanged: reloadAll });

  const stockOf = (medication: Medication): StockEstimate | 'loading' | 'failed' => {
    if (doseLogs.isLoading || stockEvents.isLoading) return 'loading';
    if (doseLogs.error !== undefined || stockEvents.error !== undefined) return 'failed';
    return estimateStock({
      medication,
      doseLogs: doseLogs.data,
      stockEvents: stockEvents.data,
      today,
    });
  };

  const closeEndDialog = () => {
    setEndTarget(null);
    setEndDateError(null);
    action.clearError();
  };

  const confirmEnd = async (dateText: string) => {
    if (endTarget === null) return;
    const endDate = parseLocalDate(dateText);
    if (endDate === null) {
      setEndDateError('Wybierz poprawną datę.');
      return;
    }
    const result = endMedication(endTarget, endDate, clock.now());
    if (!result.ok) {
      setEndDateError('Ostatni dzień nie może być wcześniejszy niż data rozpoczęcia leku.');
      return;
    }
    setEndDateError(null);
    const outcome = await action.run(() => repositories.medications.update(result.medication));
    if (outcome.status === 'success') {
      setNotice(`Zakończono lek „${endTarget.name}”. Historia przyjmowania została zachowana.`);
      closeEndDialog();
      reloadAll();
    }
  };

  const startDelete = async (medication: Medication) => {
    setProblem(null);
    const outcome = await action.run(async () => ({
      history: await repositories.doseLogs.countForMedication(medication.id),
      events: await repositories.stockEvents.countForMedication(medication.id),
    }));
    if (outcome.status === 'success') {
      setDeleteTarget({
        medication,
        historyCount: outcome.value.history,
        stockEventCount: outcome.value.events,
      });
    } else if (outcome.status === 'failed') {
      // Without the count the consequences cannot be stated, so deletion is not offered.
      setProblem({
        title: 'Nie można rozpocząć usuwania',
        message: `Nie udało się sprawdzić historii leku „${medication.name}”. ${outcome.error.message}`,
      });
    }
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
    action.clearError();
  };

  const confirmDelete = async () => {
    if (deleteTarget === null) return;
    const { medication, historyCount, stockEventCount } = deleteTarget;
    const eventsText =
      stockEventCount === 0
        ? ''
        : ` oraz historią zapasu (${String(stockEventCount)} ${pluralize(stockEventCount, eventsWord)})`;
    const outcome = await action.run(() => repositories.medications.remove(medication.id));
    if (outcome.status === 'success') {
      setNotice(
        historyCount === 0 && stockEventCount === 0
          ? `Usunięto lek „${medication.name}”. Nie miał zapisów w historii.`
          : historyCount === 0
            ? `Usunięto lek „${medication.name}” razem z historią zapasu (${String(stockEventCount)} ${pluralize(stockEventCount, eventsWord)}). Nie miał zapisów w historii przyjmowania.`
            : `Usunięto lek „${medication.name}” razem z historią przyjmowania (${String(historyCount)} ${pluralize(historyCount, recordsWord)})${eventsText}.`,
      );
      closeDeleteDialog();
      reloadAll();
    }
  };

  const endInstead = () => {
    if (deleteTarget === null) return;
    const { medication } = deleteTarget;
    closeDeleteDialog();
    setEndTarget(medication);
  };

  const sorted = medications.data ?? [];
  const ended = sorted.filter((medication) => getMedicationStatus(medication, today) === 'ended');
  const current = sorted.filter((medication) => getMedicationStatus(medication, today) !== 'ended');
  const endDefaultDate =
    endTarget !== null && compareLocalDates(endTarget.startDate, today) > 0
      ? endTarget.startDate
      : today;

  const renderGroup = (title: string, items: Medication[]) =>
    items.length === 0 ? null : (
      <section aria-labelledby={`group-${title}`} className="space-y-3">
        <h2 id={`group-${title}`} className="text-lg font-semibold">
          {title} ({String(items.length)})
        </h2>
        <ul className="space-y-4">
          {items.map((medication) => (
            <li key={medication.id}>
              <MedicationCard
                medication={medication}
                status={getMedicationStatus(medication, today)}
                stock={stockOf(medication)}
                onEnd={(target) => {
                  setNotice(null);
                  setEndTarget(target);
                }}
                onDelete={(target) => {
                  setNotice(null);
                  void startDelete(target);
                }}
                onRefill={(target) => {
                  setNotice(null);
                  stockActions.openRefill(target);
                }}
                onWaste={(target) => {
                  setNotice(null);
                  const estimate = stockOf(target);
                  stockActions.openWaste(
                    target,
                    typeof estimate !== 'string' && estimate.available ? estimate.remaining : null,
                  );
                }}
                onStartTracking={(target) => {
                  setNotice(null);
                  stockActions.openStart(target);
                }}
                timeZone={timeZone}
              />
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <>
      <PageHeader
        title="Leki"
        description="Twoje leki, harmonogramy dawkowania i szacunkowy zapas. Harmonogram ustawiasz samodzielnie."
        actions={<ButtonLink to="/medications/new">Dodaj lek</ButtonLink>}
      />

      <div role="status" aria-live="polite">
        {notice !== null && (
          <p className="mb-4 flex items-start gap-3 rounded-card border border-success-800 bg-success-50 p-4 text-success-800">
            <Icon name="check" className="mt-0.5" />
            <span className="flex-1 font-medium">{notice}</span>
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

      <div className="mb-4">
        <StockFeedback message={stockActions.feedback} onDismiss={stockActions.dismissFeedback} />
      </div>

      {problem !== null && (
        <div className="mb-4">
          <ErrorState title={problem.title} message={problem.message} />
        </div>
      )}

      {medications.isLoading && <Spinner label="Wczytywanie leków…" />}

      {medications.error !== undefined && (
        <ErrorState
          title="Nie udało się wczytać leków"
          message={medications.error.message}
          onRetry={reloadAll}
        />
      )}

      {medications.data?.length === 0 && (
        <EmptyState
          icon="pill"
          title="Nie dodano jeszcze żadnego leku"
          description="Dodaj pierwszy lek i jego godziny przyjmowania, aby zobaczyć tu harmonogram. Dane są zapisywane tylko w tej przeglądarce."
          action={<ButtonLink to="/medications/new">Dodaj pierwszy lek</ButtonLink>}
        />
      )}

      {medications.data !== undefined && medications.data.length > 0 && (
        <div className="space-y-8">
          {renderGroup('Aktywne i zaplanowane', current)}
          {renderGroup('Zakończone', ended)}
        </div>
      )}

      {stockActions.dialogs}

      <EndMedicationDialog
        medication={endTarget}
        defaultDate={endDefaultDate}
        isEnding={action.isRunning}
        dateError={endDateError}
        failure={endTarget === null ? null : action.error}
        onConfirm={(dateText) => {
          void confirmEnd(dateText);
        }}
        onCancel={closeEndDialog}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        title={
          deleteTarget === null
            ? 'Trwale usunąć lek?'
            : `Trwale usunąć lek „${deleteTarget.medication.name}”?`
        }
        confirmLabel="Usuń trwale"
        isConfirming={action.isRunning}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={closeDeleteDialog}
      >
        {deleteTarget !== null && (
          <>
            <p>
              Zostaną trwale usunięte: lek, jego harmonogram i cała historia przyjmowania:{' '}
              <strong>
                {String(deleteTarget.historyCount)}{' '}
                {pluralize(deleteTarget.historyCount, recordsWord)}
              </strong>
              {deleteTarget.stockEventCount > 0 && (
                <>
                  {' '}
                  oraz historia zapasu:{' '}
                  <strong>
                    {String(deleteTarget.stockEventCount)}{' '}
                    {pluralize(deleteTarget.stockEventCount, eventsWord)}
                  </strong>
                </>
              )}
              . Tej operacji nie można cofnąć.
            </p>
            <p>
              Jeśli chcesz tylko przestać go przyjmować, zakończ lek. Zniknie z harmonogramu, a
              historia zostanie zachowana.
            </p>
            <Button variant="secondary" onClick={endInstead}>
              Zakończ lek zamiast usuwać
            </Button>
            {action.error && (
              <p role="alert" className="text-sm font-medium text-danger-700">
                {action.error.message}
                {isRollbackFailure(action.error) &&
                  ' Dane mogą być niespójne: odśwież stronę i sprawdź listę leków.'}
              </p>
            )}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
