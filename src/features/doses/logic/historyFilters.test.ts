import { describe, expect, it } from 'vitest';
import { asLocalDate } from '@/utils/date';
import { parseHistoryFilters, type RawHistoryFilters } from './historyFilters';

const known = new Set(['med-1', 'med-2']);
const raw = (overrides: Partial<RawHistoryFilters> = {}): RawHistoryFilters => ({
  from: null,
  to: null,
  medication: null,
  status: null,
  ...overrides,
});

describe('parseHistoryFilters', () => {
  it('treats missing and empty values as "not set", without complaint', () => {
    const none = { from: null, to: null, medicationId: null, status: null };
    expect(parseHistoryFilters(raw(), known)).toEqual({ filters: none, ignoredInvalid: false });
    expect(
      parseHistoryFilters(raw({ from: '', to: '', medication: '', status: '' }), known),
    ).toEqual({ filters: none, ignoredInvalid: false });
  });

  it('reads valid values', () => {
    const result = parseHistoryFilters(
      raw({ from: '2026-10-01', to: '2026-10-31', medication: 'med-2', status: 'skipped' }),
      known,
    );
    expect(result).toEqual({
      filters: {
        from: asLocalDate('2026-10-01'),
        to: asLocalDate('2026-10-31'),
        medicationId: 'med-2',
        status: 'skipped',
      },
      ignoredInvalid: false,
    });
  });

  it.each([
    ['an impossible date', raw({ from: '2026-02-30' })],
    ['text instead of a date', raw({ to: 'wczoraj' })],
    ['an unknown status', raw({ status: 'missed' })],
    ['an unknown medication', raw({ medication: 'med-99' })],
  ])('ignores %s and reports it', (_name, input) => {
    const result = parseHistoryFilters(input, known);
    expect(result.ignoredInvalid).toBe(true);
    expect(result.filters).toEqual({ from: null, to: null, medicationId: null, status: null });
  });

  it('keeps the valid filters when another one is invalid', () => {
    const result = parseHistoryFilters(raw({ from: '2026-10-01', status: 'oops' }), known);
    expect(result.filters.from).toBe('2026-10-01');
    expect(result.filters.status).toBeNull();
    expect(result.ignoredInvalid).toBe(true);
  });
});
