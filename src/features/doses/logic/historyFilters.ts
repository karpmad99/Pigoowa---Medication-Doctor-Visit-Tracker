import type { Id } from '@/types/primitives';
import { parseLocalDate } from '@/utils/date';
import { NO_HISTORY_FILTERS, type HistoryFilters } from './history';

/** The raw text of the filters, as kept in the page address. Missing means "not set". */
export interface RawHistoryFilters {
  from: string | null;
  to: string | null;
  medication: string | null;
  status: string | null;
}

export interface ParsedHistoryFilters {
  filters: HistoryFilters;
  /** True when some given value was unusable (not a date, unknown status, unknown medication) and ignored. */
  ignoredInvalid: boolean;
}

/**
 * Turns the raw filter text into filters. Anything unusable is ignored, never guessed: an
 * impossible date such as 2026-02-30, an unknown status, or a medication that is not in
 * `knownMedicationIds`. The caller can tell the user that something was ignored.
 */
export function parseHistoryFilters(
  raw: RawHistoryFilters,
  knownMedicationIds: ReadonlySet<Id>,
): ParsedHistoryFilters {
  let ignoredInvalid = false;
  const filters: HistoryFilters = { ...NO_HISTORY_FILTERS };

  const readDate = (text: string | null) => {
    if (text === null || text === '') return null;
    const date = parseLocalDate(text);
    if (date === null) ignoredInvalid = true;
    return date;
  };
  filters.from = readDate(raw.from);
  filters.to = readDate(raw.to);

  if (raw.medication !== null && raw.medication !== '') {
    if (knownMedicationIds.has(raw.medication)) filters.medicationId = raw.medication;
    else ignoredInvalid = true;
  }

  if (raw.status !== null && raw.status !== '') {
    if (raw.status === 'taken' || raw.status === 'skipped') filters.status = raw.status;
    else ignoredInvalid = true;
  }

  return { filters, ignoredInvalid };
}
