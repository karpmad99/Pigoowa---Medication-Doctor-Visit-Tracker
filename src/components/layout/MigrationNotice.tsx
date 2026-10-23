import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useServices } from '@/hooks/useServices';
import {
  migrationNeedsAttention,
  type CollectionMigration,
  type MigrationCollectionName,
  type MigrationFailureReason,
} from '@/services/migrationReport';

const collectionNames: Record<MigrationCollectionName, string> = {
  medications: 'Leki',
  'dose-logs': 'Zapisy dawek',
  appointments: 'Wizyty',
};

const failureReasons: Record<MigrationFailureReason, string> = {
  'backup-failed': 'nie udało się zapisać kopii zapasowej',
  'changed-concurrently': 'dane były w tym czasie zmieniane w innej karcie',
  'write-failed': 'przeglądarka odmówiła zapisu',
  'verification-failed':
    'sprawdzenie po zapisie nie powiodło się, więc przywrócono poprzedni zapis',
  'storage-unavailable': 'pamięć przeglądarki jest niedostępna',
};

function describeProblem({ collection, result }: CollectionMigration): string | null {
  const name = collectionNames[collection];
  if (result.status === 'damaged') {
    return `${name}: zapisane dane są uszkodzone albo pochodzą z innej wersji aplikacji. Nie zostały zmienione.`;
  }
  if (result.status !== 'failed') return null;
  const why = result.storageFull
    ? 'brakuje miejsca w pamięci przeglądarki na kopię zapasową. Zwolnij miejsce i spróbuj ponownie'
    : `${failureReasons[result.reason]}. Spróbuj ponownie`;
  return `${name}: dane nie zostały zaktualizowane do nowego formatu (${why}). Można je przeglądać, ale zapisywanie zmian w tej części jest wstrzymane. Nic nie zostało usunięte.`;
}

/**
 * Tells the user when the start-up storage migration could not finish for a collection, or found
 * damaged data (PROJECT_SPEC §10.5). It shows nothing when everything went well, which is the
 * normal case. A retry runs the migration again; the notice disappears when it succeeds. Whether a
 * backup could be verified is kept in the report but is not shown: it needs no action from the user.
 */
export function MigrationNotice() {
  const { storageMigration } = useServices();
  const [report, setReport] = useState(() => storageMigration.current());

  if (!migrationNeedsAttention(report)) return null;
  const problems = report.collections
    .map(describeProblem)
    .filter((text): text is string => text !== null);
  const canRetry = report.collections.some(({ result }) => result.status === 'failed');

  return (
    <section
      aria-label="Aktualizacja danych w przeglądarce"
      className="border-b border-warning-800 bg-warning-50 px-4 py-3 text-sm text-warning-800 sm:px-6 md:px-8"
    >
      <div className="mx-auto max-w-4xl space-y-2">
        <p className="flex gap-2 font-semibold">
          <Icon name="alert" className="mt-0.5 size-4" />
          Dane w przeglądarce wymagają uwagi
        </p>
        <ul className="list-disc space-y-1 pl-6">
          {problems.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        {canRetry && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setReport(storageMigration.run());
            }}
          >
            Spróbuj ponownie
          </Button>
        )}
      </div>
    </section>
  );
}
