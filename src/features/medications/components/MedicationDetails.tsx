import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ModuleCard } from '@/components/ui/ModuleCard';
import { StockHistory } from '@/features/stock/components/StockHistory';
import { StockStatement } from '@/features/stock/components/StockStatement';
import { buildStockHistory } from '@/features/stock/logic/history';
import { refillAvailability } from '@/features/stock/logic/refill';
import type { StockEvent } from '@/features/stock/types';
import type { LocalDate } from '@/types/primitives';
import { formatLocalDay, formatQuantity } from '@/utils/format';
import { dosageFormLabel, isOutsideList } from '../logic/dosageForms';
import { normalizeScheduleTimes } from '../logic/schedule';
import { getMedicationStatus, type MedicationStatus } from '../logic/status';
import { LOW_STOCK_THRESHOLD_DAYS, thresholdUnitDiffers, type StockEstimate } from '../logic/stock';
import type { Medication } from '../types';
import { formatAmount } from '../logic/unitForms';
import { StockExplanation } from './StockExplanation';
import { StockSummary } from './StockSummary';

const statusLabels: Record<MedicationStatus, { text: string; tone: BadgeTone }> = {
  active: { text: 'Aktywny', tone: 'success' },
  planned: { text: 'Zaplanowany', tone: 'info' },
  ended: { text: 'Zakończony', tone: 'neutral' },
};

interface MedicationDetailsProps {
  medication: Medication;
  today: LocalDate;
  timeZone: string;
  /** `loading`/`failed` describe the intake history the estimate needs, which loads separately. */
  stock: StockEstimate | 'loading' | 'failed';
  /** The stock events (refills, waste) of all medications; this medication's are picked out here. */
  stockEvents: readonly StockEvent[];
  /** True when the events could not be read: the history says so instead of showing an empty list. */
  stockEventsFailed?: boolean;
  /** True while a stock write is in flight: the actions are disabled then. */
  stockBusy?: boolean;
  onRefill: (medication: Medication) => void;
  onWaste: (medication: Medication, remaining: number | null) => void;
  onStartTracking: (medication: Medication) => void;
  onReverse: (event: StockEvent, medicationName: string) => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_1fr]">
      <dt className="font-semibold">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * Everything the application knows about one medication, in four labelled parts: the information,
 * the schedule, the units and the stock with its warning level. A part that has nothing to show
 * says so; nothing is guessed, and nothing here changes a medication.
 */
export function MedicationDetails({
  medication,
  today,
  timeZone,
  stock,
  stockEvents,
  stockEventsFailed = false,
  stockBusy = false,
  onRefill,
  onWaste,
  onStartTracking,
  onReverse,
}: MedicationDetailsProps) {
  const status = statusLabels[getMedicationStatus(medication, today)];
  const schedule = normalizeScheduleTimes(medication.scheduleTimes);
  const threshold = medication.lowStockThreshold ?? null;
  const counted = medication.stock;
  const availability = refillAvailability(medication, today);
  const history = buildStockHistory(stockEvents, medication.id, counted);

  const period =
    medication.endDate === null
      ? `Od ${formatLocalDay(medication.startDate)}, bez daty zakończenia`
      : `Od ${formatLocalDay(medication.startDate)}, do ${formatLocalDay(medication.endDate)}`;
  const scheduleSince =
    medication.scheduleEffectiveFrom > medication.startDate
      ? medication.scheduleEffectiveFrom
      : null;

  const doseOutside = isOutsideList(medication.dosageForm, medication.doseUnit, 'dose');
  const stockOutside =
    counted !== null && isOutsideList(medication.dosageForm, counted.unit, 'stock');

  let thresholdText: string;
  if (threshold === null) {
    thresholdText = `Nie ustawiono własnego progu. Ostrzegamy, gdy zapasu wystarczy na mniej niż ${String(LOW_STOCK_THRESHOLD_DAYS)} dni.`;
  } else if (thresholdUnitDiffers(medication)) {
    thresholdText = `Własny próg (${formatAmount(threshold.quantity, threshold.unit)}) jest w innej jednostce niż zapas (${counted?.unit.trim() ?? ''}), więc nie jest stosowany. Nie przeliczamy jednostek: obowiązuje reguła „mniej niż ${String(LOW_STOCK_THRESHOLD_DAYS)} dni”. Edytuj lek i wpisz próg ponownie w jednostce zapasu.`;
  } else {
    thresholdText = `Własny próg: ${formatAmount(threshold.quantity, threshold.unit)}. Ostrzegamy, gdy szacowany zapas jest na poziomie progu lub poniżej.`;
  }

  return (
    <div className="space-y-6">
      <ModuleCard title="Informacje">
        <dl className="space-y-3 text-base">
          <Row label="Status">
            <Badge tone={status.tone}>{status.text}</Badge>
          </Row>
          <Row label="Postać">
            {medication.dosageForm === undefined
              ? 'Nie wybrano'
              : dosageFormLabel(medication.dosageForm)}
          </Row>
          <Row label="Moc (informacja)">
            {medication.strength == null ? (
              'Nie podano'
            ) : (
              <>
                {formatQuantity(medication.strength.value)} {medication.strength.unit}
                <span className="mt-1 block text-ink-muted">
                  Moc jest tylko informacją z opakowania: nie wpływa na dawkę ani na zapas.
                </span>
              </>
            )}
          </Row>
          <Row label="Okres">{period}</Row>
          <Row label="Notatki">
            {medication.notes === null ? (
              'Brak notatek'
            ) : (
              <span className="whitespace-pre-line">{medication.notes}</span>
            )}
          </Row>
        </dl>
      </ModuleCard>

      <ModuleCard title="Dawkowanie">
        {schedule.length === 0 ? (
          <p>Brak harmonogramu.</p>
        ) : (
          <ul className="space-y-1 text-lg">
            {schedule.map((entry) => (
              <li key={entry.id} className="tabular-nums">
                {entry.timeOfDay} — {formatAmount(entry.doseAmount, medication.doseUnit)}
              </li>
            ))}
          </ul>
        )}
        {scheduleSince !== null && (
          <p className="text-base text-ink-muted">
            Obecny harmonogram obowiązuje od {formatLocalDay(scheduleSince)}.
          </p>
        )}
      </ModuleCard>

      <ModuleCard title="Jednostki">
        <dl className="space-y-3 text-base">
          <Row label="Jednostka dawki">
            {medication.doseUnit.trim()}
            {doseOutside && (
              <>
                {' '}
                <Badge tone="neutral">Jednostka spoza listy</Badge>
              </>
            )}
          </Row>
          <Row label="Jednostka zapasu">
            {counted === null ? (
              'Nie śledzisz zapasu'
            ) : (
              <>
                {counted.unit.trim()}
                {stockOutside && (
                  <>
                    {' '}
                    <Badge tone="neutral">Jednostka spoza listy</Badge>
                  </>
                )}
              </>
            )}
          </Row>
        </dl>
        {(doseOutside || stockOutside) && (
          <p className="text-base text-ink-muted">
            Jednostka spoza listy została zapisana wcześniej i nie ma jej na liście dla postaci
            leku. Zostaje bez zmian i nie jest przeliczana.
          </p>
        )}
      </ModuleCard>

      <ModuleCard title="Zapas">
        <p className="text-base">
          <StockStatement medication={medication} timeZone={timeZone} />
        </p>
        <p className="text-lg">
          <StockSummary estimate={stock} threshold={threshold} basis={counted?.basis} />
        </p>
        {typeof stock !== 'string' && stock.available && stock.wentBelowZero === true && (
          <p className="text-base text-warning-800">
            Zapisane przyjęcia i straty przekraczają zapas, więc zapas mógł skończyć się wcześniej,
            niż pokazuje szacunek.
          </p>
        )}
        <p
          className={
            threshold !== null && thresholdUnitDiffers(medication)
              ? 'text-base font-medium text-warning-800'
              : 'text-base text-ink-muted'
          }
        >
          {thresholdText}
        </p>
        <StockExplanation />
        <div className="flex flex-wrap gap-3">
          {availability === 'available' && (
            <Button
              disabled={stockBusy}
              onClick={() => {
                onRefill(medication);
              }}
            >
              Uzupełnij zapas
            </Button>
          )}
          {availability === 'available' && (
            <Button
              variant="secondary"
              disabled={stockBusy}
              onClick={() => {
                onWaste(
                  medication,
                  typeof stock !== 'string' && stock.available ? stock.remaining : null,
                );
              }}
            >
              Zapisz stratę
            </Button>
          )}
          {availability === 'no-baseline' && (
            <Button
              disabled={stockBusy}
              onClick={() => {
                onStartTracking(medication);
              }}
            >
              Zacznij śledzić zapas
            </Button>
          )}
          <ButtonLink
            to={`/medications/${encodeURIComponent(medication.id)}/edit`}
            variant="secondary"
          >
            Edytuj zapas i próg
          </ButtonLink>
        </div>
        {availability === 'ended' && (
          <p className="text-base text-ink-muted">
            Lek jest zakończony, więc nie uzupełniamy jego zapasu.
          </p>
        )}
        {availability === 'no-baseline' && (
          <p className="text-base text-ink-muted">
            Uzupełnienie wymaga policzonego zapasu, do którego można dodać. Zacznij go śledzić:
            policz, ile masz, albo zacznij od nowego opakowania.
          </p>
        )}
      </ModuleCard>

      <ModuleCard title="Historia zdarzeń zapasu">
        {stockEventsFailed ? (
          <p role="alert" className="text-base font-medium text-danger-700">
            Nie udało się wczytać historii zdarzeń zapasu. Odśwież stronę i spróbuj ponownie.
          </p>
        ) : (
          <>
            <p className="text-base text-ink-muted">
              Uzupełnienia i straty zapasu, od najnowszego. Cofnięte zdarzenie zostaje na liście i
              nie zmienia szacunku. Zdarzenia sprzed ostatniego liczenia zapasu są zachowane, ale
              nie są wliczane.
            </p>
            <StockHistory
              rows={history}
              timeZone={timeZone}
              disabled={stockBusy}
              onReverse={(event) => {
                onReverse(event, medication.name);
              }}
            />
          </>
        )}
      </ModuleCard>
    </div>
  );
}
