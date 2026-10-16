import type { DoseStatus } from './types';

const labels: Record<DoseStatus, string> = {
  taken: 'Przyjęta',
  skipped: 'Pominięta',
  unrecorded: 'Nie zapisano',
};

/** The Polish word for a status. "Nie zapisano" means only that nothing was recorded. */
export function doseStatusLabel(status: DoseStatus): string {
  return labels[status];
}
