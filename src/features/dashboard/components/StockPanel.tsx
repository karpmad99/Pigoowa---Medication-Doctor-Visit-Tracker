import { useMemo } from 'react';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import type { DoseLog } from '@/features/doses/types';
import { StockExplanation } from '@/features/medications/components/StockExplanation';
import { StockSummary } from '@/features/medications/components/StockSummary';
import { summarizeStock } from '@/features/medications/logic/stockSummary';
import type { Medication } from '@/features/medications/types';
import type { AsyncDataResult } from '@/hooks/useAsyncData';
import type { LocalDate } from '@/types/primitives';
import { pluralize } from '@/utils/format';
import { DashboardPanel } from './DashboardPanel';

const medicationsWord = { one: 'leku', few: 'leków', many: 'leków' };

interface StockPanelProps {
  medications: AsyncDataResult<Medication[]>;
  doseLogs: AsyncDataResult<DoseLog[]>;
  today: LocalDate;
  onRetry: () => void;
}

/**
 * The stock summary: only the medications whose estimate can be computed (`summarizeStock`, which
 * uses `estimateStock`), the ones that run out soonest first, with the "Niski zapas" label from the
 * same rule as everywhere else. A medication without a computable estimate is never listed, only
 * counted. The text says it is an estimate, not a guarantee that the medicine is available.
 */
export function StockPanel({ medications, doseLogs, today, onRetry }: StockPanelProps) {
  const loadError = medications.error ?? doseLogs.error;
  const isLoading = medications.isLoading || doseLogs.isLoading;
  const medicationList = medications.data;
  const logList = doseLogs.data;
  const overview = useMemo(
    () =>
      medicationList === undefined || logList === undefined
        ? null
        : summarizeStock({ medications: medicationList, doseLogs: logList, today }),
    [medicationList, logList, today],
  );
  const manage = (
    <ButtonLink to="/medications" variant="secondary">
      Zarządzaj lekami
    </ButtonLink>
  );

  return (
    <DashboardPanel title="Zapasy leków">
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
              <p className="text-sm text-ink-muted">
                To szacunek na podstawie wpisanego zapasu i zapisanych przyjętych dawek, a nie
                gwarancja, że lek jest dostępny. Najpierw leki, które skończą się najszybciej.
              </p>
              <ul className="space-y-2">
                {overview.items.map((item) => (
                  <li
                    key={item.medication.id}
                    className="rounded-card border border-line bg-surface p-4"
                  >
                    <p className="break-words font-medium">{item.medication.name}</p>
                    <p className="text-sm text-ink-muted">
                      <StockSummary estimate={item.estimate} />
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {overview.unavailableCount > 0 && (
            <p className="text-sm text-ink-muted">
              {`Dla ${String(overview.unavailableCount)} ${pluralize(overview.unavailableCount, medicationsWord)} nie można policzyć szacunku (brak wpisanego zapasu, różne jednostki albo brak harmonogramu); nie są tu pokazane.`}
            </p>
          )}
          <StockExplanation />
          {manage}
        </>
      )}
    </DashboardPanel>
  );
}
