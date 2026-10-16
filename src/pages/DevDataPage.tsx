import { useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import { useDoseLogs } from '@/features/doses/hooks/useDoseLogs';
import { useMedications } from '@/features/medications/hooks/useMedications';
import { useServices } from '@/hooks/useServices';
import { usePageTitle } from '@/hooks/usePageTitle';
import type { AsyncDataResult } from '@/hooks/useAsyncData';
import { toRepositoryError } from '@/services/errors';
import { isDemoId } from '@/services/demo/demoData';
import { asLocalDate, MAX_YEAR, MIN_YEAR } from '@/utils/date';
import { formatTimestamp } from '@/utils/format';

// TEMPORARY, development-only page (see routes.tsx). It exercises the data layer in a real
// browser: loading and resetting the fictional demo data and showing loading, error and empty
// states. The real screens arrive in stages 5 to 8. Not part of production builds.

const ALL_TIME_FROM = asLocalDate(`${String(MIN_YEAR)}-01-01`);
const ALL_TIME_TO = asLocalDate(`${String(MAX_YEAR)}-12-31`);

function DataSection<T>({
  title,
  result,
  emptyText,
  children,
}: {
  title: string;
  result: AsyncDataResult<T[]>;
  emptyText: string;
  children: (items: T[]) => ReactNode;
}) {
  const { data, error, isLoading, reload } = result;
  return (
    <Card as="section" aria-label={title} className="space-y-3">
      <h2 className="text-lg font-semibold">
        {data ? `${title} (${String(data.length)})` : title}
      </h2>
      {isLoading && <Spinner />}
      {error && <ErrorState message={error.message} onRetry={reload} />}
      {data?.length === 0 && <p className="text-ink-muted">{emptyText}</p>}
      {data && data.length > 0 && children(data)}
    </Card>
  );
}

function DemoBadge({ id }: { id: string }) {
  return isDemoId(id) ? <Badge tone="info">Przykład</Badge> : null;
}

export function DevDataPage() {
  usePageTitle('Dane demonstracyjne');
  const { demoData, timeZone } = useServices();
  const medications = useMedications();
  const doseLogs = useDoseLogs(ALL_TIME_FROM, ALL_TIME_TO);
  const appointments = useAppointments();

  const [isWorking, setIsWorking] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [message, setMessage] = useState('');

  const reloadAll = () => {
    medications.reload();
    doseLogs.reload();
    appointments.reload();
  };

  const runAction = async (action: () => Promise<void>, success: string) => {
    setIsWorking(true);
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(`Nie udało się: ${toRepositoryError(error).message}`);
    } finally {
      setIsWorking(false);
      reloadAll();
    }
  };

  return (
    <>
      <PageHeader
        title="Dane demonstracyjne"
        description="Tymczasowa strona deweloperska do sprawdzania warstwy danych. Nie jest dostępna w wersji produkcyjnej."
      />
      <div className="space-y-6 pb-8">
        <Card className="space-y-4">
          <p className="text-sm text-ink-muted">
            Dane są zapisywane w pamięci tej przeglądarki (localStorage). To nie jest bezpieczne
            miejsce na prawdziwe dane medyczne: używaj wyłącznie danych fikcyjnych.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              isLoading={isWorking}
              onClick={() => {
                void runAction(() => demoData.loadDemoData(), 'Wczytano dane demonstracyjne.');
              }}
            >
              Wczytaj dane demonstracyjne
            </Button>
            <Button
              variant="danger"
              disabled={isWorking}
              onClick={() => {
                setConfirmingReset(true);
              }}
            >
              Przywróć dane demonstracyjne…
            </Button>
          </div>
          <p role="status" className="text-sm font-medium">
            {message}
          </p>
          <p className="text-sm text-ink-muted">Strefa czasowa: {timeZone}</p>
        </Card>

        <DataSection title="Leki" result={medications} emptyText="Brak zapisanych leków.">
          {(items) => (
            <ul className="space-y-2">
              {items.map((medication) => (
                <li key={medication.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{medication.name}</span>
                  <span className="text-ink-muted">({medication.doseUnit})</span>
                  <DemoBadge id={medication.id} />
                  {medication.endDate !== null && <Badge>Zakończony</Badge>}
                </li>
              ))}
            </ul>
          )}
        </DataSection>

        <DataSection
          title="Zapisy przyjęcia leków"
          result={doseLogs}
          emptyText="Brak zapisów przyjęcia leków."
        >
          {(items) => (
            <p className="text-ink-muted">
              Liczba zapisów: {String(items.length)}. Szczegóły pojawią się w kolejnych etapach.
            </p>
          )}
        </DataSection>

        <DataSection title="Wizyty" result={appointments} emptyText="Brak zapisanych wizyt.">
          {(items) => (
            <ul className="space-y-2">
              {items.map((appointment) => (
                <li key={appointment.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {appointment.doctorName ?? appointment.specialty ?? ''}
                  </span>
                  <span className="text-ink-muted">
                    {formatTimestamp(appointment.scheduledAt, timeZone)}
                  </span>
                  <DemoBadge id={appointment.id} />
                </li>
              ))}
            </ul>
          )}
        </DataSection>
      </div>

      <ConfirmDialog
        open={confirmingReset}
        tone="danger"
        title="Przywrócić dane demonstracyjne?"
        confirmLabel="Przywróć dane demonstracyjne"
        onCancel={() => {
          setConfirmingReset(false);
        }}
        onConfirm={() => {
          setConfirmingReset(false);
          void runAction(() => demoData.resetDemoData(), 'Przywrócono dane demonstracyjne.');
        }}
      >
        <p>
          Wszystkie zapisane dane zostaną zastąpione danymi demonstracyjnymi. Poprzednia zawartość
          zostanie najpierw skopiowana do kopii zapasowej w pamięci przeglądarki. Przechowywana jest
          tylko ostatnia kopia.
        </p>
      </ConfirmDialog>
    </>
  );
}
