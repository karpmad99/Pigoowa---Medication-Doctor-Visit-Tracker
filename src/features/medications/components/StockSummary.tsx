import { Badge } from '@/components/ui/Badge';
import { pluralize } from '@/utils/format';
import { isLowStock, type StockEstimate, type StockUnavailableReason } from '../logic/stock';
import { formatAmount } from '../logic/unitForms';

const unavailableReasons: Record<StockUnavailableReason, string> = {
  'no-stock': 'zapas nie został skonfigurowany. Wpisz go, edytując lek.',
  'invalid-data': 'zapisane dane zapasu są nieprawidłowe.',
  ended: 'lek został zakończony.',
  'no-schedule': 'lek nie ma harmonogramu.',
  'incompatible-units':
    'jednostka zapasu różni się od jednostki dawki. Edytuj lek i wpisz zapas ponownie.',
};

interface StockSummaryProps {
  /** `loading`/`failed` describe the intake history the estimate needs, which loads separately. */
  estimate: StockEstimate | 'loading' | 'failed';
}

/**
 * The stock line of a medication. It shows a number ONLY when the estimate is available; in every
 * other case it says that the estimate is unavailable and why. Nothing is ever guessed.
 * The status is always written out, never conveyed by colour alone.
 */
export function StockSummary({ estimate }: StockSummaryProps) {
  if (estimate === 'loading') return <span className="text-ink-muted">Obliczanie zapasu…</span>;
  if (estimate === 'failed') {
    return (
      <span>
        Szacunek niedostępny: nie udało się wczytać historii przyjmowania, z której się go liczy.
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
      {isLowStock(estimate) && <Badge tone="warning">Niski zapas</Badge>}
    </span>
  );
}
