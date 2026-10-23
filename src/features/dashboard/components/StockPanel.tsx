import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import type { DoseLog } from '@/features/doses/types';
import { StockExplanation } from '@/features/medications/components/StockExplanation';
import { StockSummary } from '@/features/medications/components/StockSummary';
import {
  isLowStock,
  LOW_STOCK_THRESHOLD_DAYS,
  lowStockRule,
} from '@/features/medications/logic/stock';
import { summarizeStock } from '@/features/medications/logic/stockSummary';
import type { Medication } from '@/features/medications/types';
import { StockFeedback } from '@/features/stock/components/StockFeedback';
import { StockStatement } from '@/features/stock/components/StockStatement';
import { useStockActions } from '@/features/stock/hooks/useStockActions';
import type { StockEvent } from '@/features/stock/types';
import type { AsyncDataResult } from '@/hooks/useAsyncData';
import type { LocalDate } from '@/types/primitives';
import { cx } from '@/utils/cx';
import { pluralize } from '@/utils/format';
import { DashboardPanel } from './DashboardPanel';

const medicationsWord = { one: 'leku', few: 'leków', many: 'leków' };
const lowStockWord = { one: 'lek', few: 'leki', many: 'leków' };

interface StockPanelProps {
  medications: AsyncDataResult<Medication[]>;
  doseLogs: AsyncDataResult<DoseLog[]>;
  stockEvents: AsyncDataResult<StockEvent[]>;
  today: LocalDate;
  timeZone: string;
  onRetry: () => void;
}

/**
 * The stock summary: only the medications whose estimate can be computed (`summarizeStock`, which
 * uses `estimateStock`), the ones that run out soonest first, with the "Niski zapas" label from the
 * same rule as everywhere else. When some are low, a line above the list says how many (a count, in
 * words, with the warning colour and an icon), and each of those rows is framed in that colour; the
 * "Niski zapas" text stays in the row, so the colour is never the only signal. A medication without a computable estimate is never listed, only
 * counted. The text says it is an estimate, not a guarantee that the medicine is available.
 */
export function StockPanel({
  medications,
  doseLogs,
  stockEvents,
  today,
  timeZone,
  onRetry,
}: StockPanelProps) {
  const loadError = medications.error ?? doseLogs.error ?? stockEvents.error;
  const isLoading = medications.isLoading || doseLogs.isLoading || stockEvents.isLoading;
  const medicationList = medications.data;
  const logList = doseLogs.data;
  const eventList = stockEvents.data;
  const overview = useMemo(
    () =>
      medicationList === undefined || logList === undefined || eventList === undefined
        ? null
        : summarizeStock({
            medications: medicationList,
            doseLogs: logList,
            stockEvents: eventList,
            today,
          }),
    [medicationList, logList, eventList, today],
  );
  // A refill adds an event only, so only the events are read again: the estimate and the warnings
  // below are computed afresh from what is stored.
  const stockActions = useStockActions({ onChanged: stockEvents.reload });
  const lowCount =
    overview?.items.filter((item) => isLowStock(item.estimate, item.medication.lowStockThreshold))
      .length ?? 0;
  const lowByThreshold =
    overview?.items.filter(
      (item) =>
        isLowStock(item.estimate, item.medication.lowStockThreshold) &&
        lowStockRule(item.estimate, item.medication.lowStockThreshold) === 'threshold',
    ).length ?? 0;
  const manage = (
    <ButtonLink to="/medications" variant="secondary">
      Zarządzaj lekami
    </ButtonLink>
  );

  return (
    <DashboardPanel title="Zapasy leków">
      <StockFeedback message={stockActions.feedback} onDismiss={stockActions.dismissFeedback} />
      {isLoading && <Spinner label="Wczytywanie zapasów…" />}

      {loadError !== undefined && (
        <ErrorState
          title="Nie udało się wczytać zapasów"
          message={loadError.message}
          onRetry={onRetry}
        />
      )}

      {loadError === undefined && medicationList?.length === 0 && (
        <EmptyState
          icon="pill"
          title="Brak leków"
          description="Dodaj lek i wpisz jego zapas, aby zobaczyć tu szacunek."
          action={<ButtonLink to="/medications/new">Dodaj pierwszy lek</ButtonLink>}
        />
      )}

      {overview !== null && medicationList !== undefined && medicationList.length > 0 && (
        <>
          {overview.items.length === 0 ? (
            <EmptyState
              icon="info"
              title="Nie można jeszcze oszacować zapasu"
              description="Żaden lek nie ma obliczalnego szacunku. Wpisz zapas w edycji leku (w tej samej jednostce co dawka), aby zobaczyć go tutaj."
            />
          ) : (
            <>
              {lowCount > 0 && (
                <p className="flex items-start gap-3 rounded-card border border-warning-800 bg-warning-50 p-4 text-lg font-semibold text-warning-800">
                  <Icon name="alert" className="mt-1" />
                  <span className="min-w-0">
                    {`Niski zapas: ${String(lowCount)} ${pluralize(lowCount, lowStockWord)}. ${
                      lowByThreshold === 0
                        ? `Szacunek wystarczy na mniej niż ${String(LOW_STOCK_THRESHOLD_DAYS)} dni.`
                        : `Dla leków z własnym progiem ostrzegamy, gdy zapas jest na poziomie progu lub poniżej, dla pozostałych, gdy wystarczy na mniej niż ${String(LOW_STOCK_THRESHOLD_DAYS)} dni.`
                    }`}
                  </span>
                </p>
              )}
              <p className="text-base text-ink-muted">
                To szacunek na podstawie wpisanego zapasu i zapisanych przyjętych dawek, a nie
                gwarancja, że lek jest dostępny. Najpierw leki, które skończą się najszybciej.
              </p>
              <ul className="space-y-2">
                {overview.items.map((item) => (
                  <li
                    key={item.medication.id}
                    className={cx(
                      'rounded-card border p-4',
                      isLowStock(item.estimate, item.medication.lowStockThreshold)
                        ? 'border-warning-800 bg-warning-50'
                        : 'border-line bg-canvas',
                    )}
                  >
                    <p className="break-words text-lg font-semibold">{item.medication.name}</p>
                    <p className="text-base text-ink-muted">
                      <StockSummary
                        estimate={item.estimate}
                        threshold={item.medication.lowStockThreshold}
                        basis={item.medication.stock?.basis}
                      />
                    </p>
                    <p className="text-base text-ink-muted">
                      <StockStatement medication={item.medication} timeZone={timeZone} />
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => {
                        stockActions.openRefill(item.medication);
                      }}
                    >
                      Uzupełnij zapas <span className="sr-only">leku {item.medication.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {overview.unavailableCount > 0 && (
            <p className="text-base text-ink-muted">
              {`Dla ${String(overview.unavailableCount)} ${pluralize(overview.unavailableCount, medicationsWord)} nie można policzyć szacunku (brak wpisanego zapasu, różne jednostki albo brak harmonogramu); nie są tu pokazane.`}
            </p>
          )}
          <StockExplanation />
          {manage}
        </>
      )}
      {stockActions.dialogs}
    </DashboardPanel>
  );
}
