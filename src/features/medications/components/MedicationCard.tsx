import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { isDemoId } from '@/services/demo/demoData';
import type { LocalDate } from '@/types/primitives';
import { formatLocalDay } from '@/utils/format';
import { normalizeScheduleTimes } from '../logic/schedule';
import type { MedicationStatus } from '../logic/status';
import type { StockEstimate } from '../logic/stock';
import type { Medication } from '../types';
import { formatAmount } from '../logic/unitForms';
import { StockSummary } from './StockSummary';

const statusLabels: Record<MedicationStatus, { text: string; tone: BadgeTone }> = {
  active: { text: 'Aktywny', tone: 'success' },
  planned: { text: 'Zaplanowany', tone: 'info' },
  ended: { text: 'Zakończony', tone: 'neutral' },
};

interface MedicationCardProps {
  medication: Medication;
  status: MedicationStatus;
  stock: StockEstimate | 'loading' | 'failed';
  onEnd: (medication: Medication) => void;
  onDelete: (medication: Medication) => void;
}

function period(medication: Medication): string {
  const from = `Od ${formatLocalDay(medication.startDate)}`;
  return medication.endDate === null
    ? `${from}, bez daty zakończenia`
    : `${from}, do ${formatLocalDay(medication.endDate)}`;
}

function scheduleSince(medication: Medication): LocalDate | null {
  return medication.scheduleEffectiveFrom > medication.startDate
    ? medication.scheduleEffectiveFrom
    : null;
}

/** One medication: its name and status, period, daily schedule, stock estimate and actions. */
export function MedicationCard({
  medication,
  status,
  stock,
  onEnd,
  onDelete,
}: MedicationCardProps) {
  const headingId = `medication-${medication.id}`;
  const label = statusLabels[status];
  const schedule = normalizeScheduleTimes(medication.scheduleTimes);
  const since = scheduleSince(medication);
  // Visually hidden, so that each button's accessible name says which medication it is about.
  // The space before it is a normal text node (not inside the span): trimming of the span's own
  // text would otherwise glue the words together in the computed name.
  const ofMedication = <span className="sr-only">lek {medication.name}</span>;
  const endName = <span className="sr-only">{medication.name}</span>;

  return (
    <article
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="text-lg font-semibold">
          {medication.name}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Badge tone={label.tone}>{label.text}</Badge>
          {isDemoId(medication.id) && <Badge tone="info">Przykład</Badge>}
        </div>
      </div>

      <dl className="mt-3 space-y-3 text-sm">
        <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
          <dt className="font-semibold">Okres</dt>
          <dd>{period(medication)}</dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
          <dt className="font-semibold">Dawkowanie</dt>
          <dd>
            {schedule.length === 0 ? (
              'Brak harmonogramu'
            ) : (
              <ul className="space-y-0.5">
                {schedule.map((entry) => (
                  <li key={entry.id}>
                    {entry.timeOfDay} — {formatAmount(entry.doseAmount, medication.doseUnit)}
                  </li>
                ))}
              </ul>
            )}
            {since !== null && (
              <span className="mt-1 block text-ink-muted">
                Obecny harmonogram obowiązuje od {formatLocalDay(since)}.
              </span>
            )}
          </dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
          <dt className="font-semibold">Zapas (szacunek)</dt>
          <dd>
            <StockSummary estimate={stock} />
          </dd>
        </div>
        {medication.notes !== null && (
          <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
            <dt className="font-semibold">Notatki</dt>
            <dd className="whitespace-pre-line">{medication.notes}</dd>
          </div>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <ButtonLink
          to={`/medications/${encodeURIComponent(medication.id)}/edit`}
          variant="secondary"
          size="sm"
        >
          Edytuj {ofMedication}
        </ButtonLink>
        {status !== 'ended' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onEnd(medication);
            }}
          >
            Zakończ lek {endName}
          </Button>
        )}
        <Button
          variant="dangerOutline"
          size="sm"
          onClick={() => {
            onDelete(medication);
          }}
        >
          <Icon name="alert" className="size-4" />
          Usuń trwale… {ofMedication}
        </Button>
      </div>
    </article>
  );
}
