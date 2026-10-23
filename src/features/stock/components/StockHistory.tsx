import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatAmount } from '@/features/medications/logic/unitForms';
import { formatTimestamp } from '@/utils/format';
import type { StockEventState, StockHistoryRow } from '../logic/history';
import type { StockEvent } from '../types';

const stateBadge: Record<StockEventState, { text: string; tone: BadgeTone }> = {
  counted: { text: 'Wliczone w szacunek', tone: 'success' },
  reversed: { text: 'Cofnięte', tone: 'neutral' },
  'before-count': { text: 'Sprzed ostatniego liczenia, nie wlicza się', tone: 'info' },
  'not-tracked': { text: 'Zapas nie jest śledzony, nie wlicza się', tone: 'neutral' },
};

function kindText(event: StockEvent): string {
  const amount = formatAmount(event.amount, event.unit);
  return event.kind === 'refill' ? `Uzupełnienie: dodano ${amount}` : `Strata: odjęto ${amount}`;
}

interface StockHistoryProps {
  rows: readonly StockHistoryRow[];
  timeZone: string;
  /** Offered for an event that is not reversed. Omitted where the history is only shown. */
  onReverse?: (event: StockEvent) => void;
  disabled?: boolean;
}

/**
 * The history of a medication's stock events, newest first, exactly as stored. Each row says what
 * happened, when, its note, and in words what it does to the estimate now (counted, reversed,
 * before the last count): a reversed event stays here, and an event older than the last count is
 * not hidden, only marked as not counted.
 */
export function StockHistory({ rows, timeZone, onReverse, disabled = false }: StockHistoryProps) {
  if (rows.length === 0) {
    return (
      <p className="text-base text-ink-muted">
        Brak zdarzeń zapasu. Uzupełnienie lub strata zapasu pojawi się tutaj.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map(({ event, state }) => {
        const when = formatTimestamp(event.recordedAt, timeZone);
        const badge = stateBadge[state];
        return (
          <li key={event.id} className="rounded-card border border-line bg-canvas p-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 space-y-1">
                <p className="text-lg font-semibold">{kindText(event)}</p>
                <p className="text-base text-ink-muted">
                  <time dateTime={event.recordedAt}>{when}</time>
                </p>
              </div>
              <Badge tone={badge.tone}>{badge.text}</Badge>
            </div>
            {event.note !== null && (
              <p className="mt-2 whitespace-pre-line break-words text-base">
                <span className="font-semibold">Notatka: </span>
                {event.note}
              </p>
            )}
            {event.reversedAt !== null && (
              <p className="mt-2 text-base text-ink-muted">
                Cofnięto {formatTimestamp(event.reversedAt, timeZone)}. Zdarzenie zostaje w historii
                i nie zmienia szacunku.
              </p>
            )}
            {event.reversedAt === null && onReverse !== undefined && (
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Cofnij: ${kindText(event)}, ${when}`}
                  onClick={() => {
                    onReverse(event);
                  }}
                >
                  Cofnij
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
