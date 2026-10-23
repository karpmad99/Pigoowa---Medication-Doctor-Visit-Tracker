import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import type { MigrationReport, StorageMigration } from '@/services/migrationReport';
import { createTestServices } from '@/test/services';
import { MigrationNotice } from './MigrationNotice';

function report(...collections: MigrationReport['collections']): MigrationReport {
  return { collections };
}

const verified = { state: 'verified' } as const;

function renderWith(first: MigrationReport, afterRetry?: MigrationReport) {
  let runs = 0;
  let latest = first;
  const storageMigration: StorageMigration = {
    current: () => latest,
    run: () => {
      runs += 1;
      latest = afterRetry ?? first;
      return latest;
    },
  };
  render(
    <ServicesProvider services={{ ...createTestServices(), storageMigration }}>
      <MigrationNotice />
    </ServicesProvider>,
  );
  return { runs: () => runs };
}

describe('MigrationNotice', () => {
  it('shows nothing when everything went well, also when a backup is not verified', () => {
    renderWith(
      report(
        { collection: 'medications', result: { status: 'migrated', verification: verified } },
        {
          collection: 'dose-logs',
          result: {
            status: 'already-migrated',
            verification: { state: 'not-verified', reason: 'origin-unknown' },
          },
        },
        { collection: 'appointments', result: { status: 'absent' } },
      ),
    );

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('says that there is no room for the backup, that the data is untouched and unchanged, and offers a retry', () => {
    renderWith(
      report({
        collection: 'dose-logs',
        result: { status: 'failed', reason: 'backup-failed', storageFull: true },
      }),
    );

    const notice = screen.getByRole('region', { name: 'Aktualizacja danych w przeglądarce' });
    expect(notice).toHaveTextContent('Zapisy dawek');
    expect(notice).toHaveTextContent('brakuje miejsca w pamięci przeglądarki na kopię zapasową');
    expect(notice).toHaveTextContent('zapisywanie zmian w tej części jest wstrzymane');
    expect(notice).toHaveTextContent('Nic nie zostało usunięte');
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeInTheDocument();
  });

  it.each([
    ['backup-failed', 'nie udało się zapisać kopii zapasowej'],
    ['changed-concurrently', 'zmieniane w innej karcie'],
    ['write-failed', 'przeglądarka odmówiła zapisu'],
    ['verification-failed', 'przywrócono poprzedni zapis'],
    ['storage-unavailable', 'pamięć przeglądarki jest niedostępna'],
  ] as const)('gives the reason for %s', (reason, text) => {
    renderWith(
      report({
        collection: 'medications',
        result: { status: 'failed', reason, storageFull: false },
      }),
    );

    expect(screen.getByRole('region')).toHaveTextContent(text);
  });

  it('reports damaged data without a retry button, since a retry cannot repair it', () => {
    renderWith(report({ collection: 'appointments', result: { status: 'damaged' } }));

    expect(screen.getByRole('region')).toHaveTextContent('Wizyty: zapisane dane są uszkodzone');
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).not.toBeInTheDocument();
  });

  it('runs the migration again on retry and disappears when it succeeds', async () => {
    const user = userEvent.setup();
    const { runs } = renderWith(
      report({
        collection: 'medications',
        result: { status: 'failed', reason: 'backup-failed', storageFull: true },
      }),
      report({ collection: 'medications', result: { status: 'migrated', verification: verified } }),
    );

    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(runs()).toBe(1);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('keeps showing the problem when the retry fails again', async () => {
    const user = userEvent.setup();
    renderWith(
      report({
        collection: 'medications',
        result: { status: 'failed', reason: 'backup-failed', storageFull: true },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(screen.getByRole('region')).toHaveTextContent('Leki');
  });
});
