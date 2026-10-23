import type { Repositories } from '@/services/repositories';
import type { LocalDate } from '@/types/primitives';

export async function exportUserData(repositories: Repositories): Promise<{ ok: boolean; error?: string }> {
  try {
    const [medications, appointments, stockEvents] = await Promise.all([
      repositories.medications.list(),
      repositories.appointments.list(),
      repositories.stockEvents.list(),
    ]);

    const doseLogs = await repositories.doseLogs.listByDateRange('2020-01-01' as LocalDate, '2035-12-31' as LocalDate);

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: 1,
      medications,
      doseLogs,
      appointments,
      stockEvents,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pigoowa-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
