import type { Medication } from '@/features/medications/types';
import { formatAmount } from '@/features/medications/logic/unitForms';
import { formatLocalDay, formatTimestamp } from '@/utils/format';
import { getLocalDateInZone } from '@/utils/timeZone';

/**
 * What the screen states about where the stock figure comes from (PROJECT_SPEC §7.6, "The three
 * stock states"). Three states, three different statements, in words:
 * - counted: "Policzono {date}: {quantity}." (also for stock saved before the basis existed);
 * - new package: "Liczone od nowego opakowania z {date}: {size}. Wcześniejszej pozostałości nie
 *   uwzględniamy, więc zapas może być większy." It is never worded as a count;
 * - unknown (no stock): "Nie śledzisz zapasu.", with no number at all.
 */
export function StockStatement({
  medication,
  timeZone,
}: {
  medication: Medication;
  timeZone: string;
}) {
  const { stock } = medication;
  if (stock === null) return <span>Nie śledzisz zapasu.</span>;
  const amount = formatAmount(stock.quantity, stock.unit);
  if (stock.basis === 'new-package') {
    return (
      <span>
        Liczone od nowego opakowania z {formatLocalDay(getLocalDateInZone(stock.asOf, timeZone))}:{' '}
        {amount}. Wcześniejszej pozostałości nie uwzględniamy, więc zapas może być większy.
      </span>
    );
  }
  return (
    <span>
      Policzono {formatTimestamp(stock.asOf, timeZone)}: {amount}.
    </span>
  );
}
