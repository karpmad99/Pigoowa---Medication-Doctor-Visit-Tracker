import { useParams } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { useDoseLogs } from '@/features/doses/hooks/useDoseLogs';
import { MedicationDetails } from '@/features/medications/components/MedicationDetails';
import { StockFeedback } from '@/features/stock/components/StockFeedback';
import { useStockActions } from '@/features/stock/hooks/useStockActions';
import { useStockEvents } from '@/features/stock/hooks/useStockEvents';
import { useMedication } from '@/features/medications/hooks/useMedication';
import { estimateStock } from '@/features/medications/logic/stock';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { EARLIEST_LOCAL_DATE, LATEST_LOCAL_DATE } from '@/utils/date';
import { getLocalDateInZone } from '@/utils/timeZone';

/**
 * One medication in full (`/medications/:id`): information, schedule, units and the stock with its
 * warning level. It only shows: changing anything goes through the edit form.
 */
export function MedicationDetailsPage() {
  const { medicationId = '' } = useParams();
  const { clock, timeZone } = useServices();
  const medication = useMedication(medicationId);
  // The intake history is read only because the stock estimate is computed from it.
  const doseLogs = useDoseLogs(EARLIEST_LOCAL_DATE, LATEST_LOCAL_DATE);
  // And the stock events: the estimate adds the refills and subtracts the waste, and the history lists them.
  const stockEvents = useStockEvents();
  const today = getLocalDateInZone(clock.now(), timeZone);
  usePageTitle(medication.data === undefined ? 'Szczegóły leku' : medication.data.name);

  const reload = () => {
    medication.reload();
    doseLogs.reload();
    stockEvents.reload();
  };
  const stockActions = useStockActions({ onChanged: reload });

  const data = medication.data;
  const stock =
    data === undefined
      ? 'loading'
      : doseLogs.isLoading || stockEvents.isLoading
        ? 'loading'
        : doseLogs.error !== undefined || stockEvents.error !== undefined
          ? 'failed'
          : estimateStock({
              medication: data,
              doseLogs: doseLogs.data,
              stockEvents: stockEvents.data,
              today,
            });

  return (
    <>
      <div className="mb-4">
        <ButtonLink to="/medications" variant="ghost" size="sm" className="-ml-3">
          ← Wróć do listy leków
        </ButtonLink>
      </div>
      <PageHeader
        title={data?.name ?? 'Szczegóły leku'}
        description="Postać, moc, harmonogram, jednostki i szacunkowy zapas tego leku."
        actions={
          data === undefined ? undefined : (
            <ButtonLink to={`/medications/${encodeURIComponent(data.id)}/edit`} variant="secondary">
              Edytuj lek
            </ButtonLink>
          )
        }
      />
      {medication.isLoading && <Spinner label="Wczytywanie leku…" />}
      {medication.error?.code === 'not-found' && (
        <EmptyState
          icon="pill"
          title="Nie znaleziono leku"
          description="Ten lek nie istnieje. Mógł zostać usunięty."
          action={<ButtonLink to="/medications">Wróć do listy leków</ButtonLink>}
        />
      )}
      {medication.error !== undefined && medication.error.code !== 'not-found' && (
        <ErrorState
          title="Nie udało się wczytać leku"
          message={medication.error.message}
          onRetry={reload}
        />
      )}
      {data !== undefined && (
        <div className="space-y-6">
          <StockFeedback message={stockActions.feedback} onDismiss={stockActions.dismissFeedback} />
          <MedicationDetails
            medication={data}
            today={today}
            timeZone={timeZone}
            stock={stock}
            stockEvents={stockEvents.data ?? []}
            stockEventsFailed={stockEvents.error !== undefined}
            stockBusy={stockActions.isBusy}
            onRefill={stockActions.openRefill}
            onWaste={stockActions.openWaste}
            onStartTracking={stockActions.openStart}
            onReverse={stockActions.openReverse}
          />
        </div>
      )}
      {stockActions.dialogs}
    </>
  );
}
