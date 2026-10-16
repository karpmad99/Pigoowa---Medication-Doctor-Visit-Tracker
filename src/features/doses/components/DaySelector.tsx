import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  addDays,
  compareLocalDates,
  EARLIEST_LOCAL_DATE,
  LATEST_LOCAL_DATE,
  parseLocalDate,
} from '@/utils/date';
import { formatLocalDate } from '@/utils/format';
import type { LocalDate } from '@/types/primitives';

interface DaySelectorProps {
  date: LocalDate;
  /** The current local day, from the injected clock and the user's time zone. */
  today: LocalDate;
  onChange: (date: LocalDate) => void;
}

function relativeLabel(date: LocalDate, today: LocalDate): string | null {
  const days = compareLocalDates(date, today);
  if (days === 0) return 'Dziś';
  if (date === addDays(today, 1)) return 'Jutro';
  if (date === addDays(today, -1)) return 'Wczoraj';
  return null;
}

/**
 * Chooses the day to look at: the day itself written out in Polish (announced when it changes),
 * previous and next day, a date field, and a way back to today. All of it works with the keyboard.
 */
export function DaySelector({ date, today, onChange }: DaySelectorProps) {
  const inputId = useId();
  const relative = relativeLabel(date, today);
  const canGoBack = compareLocalDates(date, EARLIEST_LOCAL_DATE) > 0;
  const canGoForward = compareLocalDates(date, LATEST_LOCAL_DATE) < 0;

  return (
    <section aria-label="Wybór dnia" className="rounded-card border border-line bg-surface p-4">
      <p className="text-sm text-ink-muted">Wybrany dzień</p>
      <h2 className="text-xl font-semibold" aria-live="polite" aria-atomic="true">
        {relative !== null && <>{relative}: </>}
        {formatLocalDate(date)}
      </h2>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
        <Button
          variant="secondary"
          disabled={!canGoBack}
          onClick={() => {
            onChange(addDays(date, -1));
          }}
        >
          <span aria-hidden="true">‹</span> Poprzedni dzień
        </Button>
        <Button
          variant="secondary"
          disabled={!canGoForward}
          onClick={() => {
            onChange(addDays(date, 1));
          }}
        >
          Następny dzień <span aria-hidden="true">›</span>
        </Button>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor={inputId} className="block text-sm font-semibold text-ink">
            Przejdź do dnia
          </label>
          <Input
            id={inputId}
            type="date"
            value={date}
            min={EARLIEST_LOCAL_DATE}
            max={LATEST_LOCAL_DATE}
            onChange={(event) => {
              // An empty or incomplete value is not a day: keep the current one.
              const chosen = parseLocalDate(event.target.value);
              if (chosen !== null) onChange(chosen);
            }}
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            onChange(today);
          }}
        >
          Dziś
        </Button>
      </div>
    </section>
  );
}
