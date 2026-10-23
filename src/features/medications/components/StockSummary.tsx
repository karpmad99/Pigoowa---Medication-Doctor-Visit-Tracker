import { Badge } from '@/components/ui/Badge';
import { pluralize } from '@/utils/format';
import {
  isLowStock,
  lowStockRule,
  type StockEstimate,
  type StockUnavailableReason,
} from '../logic/stock';
import type { LowStockThreshold, StockBasis } from '../types';
import { formatAmount } from '../logic/unitForms';

const unavailableReasons: Record<StockUnavailableReason, string> = {
  'no-stock': 'zapas nie został policzony.',
  'invalid-data': 'zapisane dane zapasu są nieprawidłowe.',
  ended: 'lek został zakończony.',
  'no-schedule': 'lek nie ma harmonogramu.',
  'incompatible-units':
    'jednostka zapasu różni się od jednostki dawki. Edytuj lek i wpisz zapas ponownie.',
};

interface StockSummaryProps {
  /** `loading`/`failed` describe the intake history the estimate needs, which loads separately. */
  estimate: StockEstimate | 'loading' | 'failed';
  /** The medication's own threshold, if it has one. Without it the 7-day rule decides. */
  threshold?: LowStockThreshold | null;
  /**
   * How the stock was started (DEC-52). For `new-package` every number carries the label "od
   * nowego opakowania", because what was left before is not counted; it is never presented as counted.
   */
  basis?: StockBasis;
}

/**
 * The stock line of a medication. It shows a number ONLY when the estimate is available; in every
 * other case it says that the estimate is unavailable and why. Nothing is ever guessed.
 * The status is always written out, never conveyed by colour alone.
 */
export function StockSummary({ estimate, threshold, basis }: StockSummaryProps) {
  if (estimate === 'loading') return <span className="text-ink-muted">Obliczanie zapasu…</span>;
  if (estimate === 'failed') {
    return (
      <span>
        Szacunek niedostępny: nie udało się wczytać historii przyjmowania lub zdarzeń zapasu, z
        których się go liczy.
      </span>
    );
  }
  if (!estimate.available) {
    return <span>Szacunek niedostępny: {unavailableReasons[estimate.reason]}</span>;
  }

  const days = estimate.daysRemaining;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        {estimate.remaining === 0
          ? `Zapas wyczerpany (${formatAmount(0, estimate.unit)}).`
          : `Pozostało ok. ${formatAmount(estimate.remaining, estimate.unit)}, wystarczy na ${
              days === 0
                ? 'mniej niż 1 dzień'
                : `ok. ${String(days)} ${pluralize(days, { one: 'dzień', few: 'dni', many: 'dni' })}`
            }.`}
      </span>
      {basis === 'new-package' && <Badge tone="info">od nowego opakowania</Badge>}
      {isLowStock(estimate, threshold) && <Badge tone="warning">Niski zapas</Badge>}
      {isLowStock(estimate, threshold) && basis === 'new-package' && (
        <span className="basis-full text-ink-muted">
          To ostrzeżenie dotyczy liczenia od nowego opakowania, bez wcześniejszej pozostałości.
        </span>
      )}
      {isLowStock(estimate, threshold) &&
        lowStockRule(estimate, threshold) === 'threshold' &&
        threshold !== null &&
        threshold !== undefined && (
          <span className="basis-full text-ink-muted">
            Zapas jest na poziomie Twojego progu ({formatAmount(threshold.quantity, threshold.unit)}
            ) lub poniżej.
          </span>
        )}
    </span>
  );
}
