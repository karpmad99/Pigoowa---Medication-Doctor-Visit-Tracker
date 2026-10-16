import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StockEstimate, StockUnavailableReason } from '../logic/stock';
import { StockSummary } from './StockSummary';

function available(remaining: number, daysRemaining: number, unit = 'tabletka'): StockEstimate {
  return { available: true, remaining, unit, daysRemaining };
}

function text(estimate: StockEstimate | 'loading' | 'failed') {
  const { container } = render(<StockSummary estimate={estimate} />);
  return container.textContent;
}

describe('StockSummary', () => {
  it('shows the remaining amount and the days it lasts when the estimate is available', () => {
    expect(text(available(28, 14))).toBe('Pozostało ok. 28 tabletek, wystarczy na ok. 14 dni.');
  });

  it.each([
    [1, 'ok. 1 dzień'],
    [2, 'ok. 2 dni'],
    [5, 'ok. 5 dni'],
    [22, 'ok. 22 dni'],
  ])('uses the right Polish word for %s days', (days, expected) => {
    expect(text(available(50, days))).toContain(expected);
  });

  it('writes decimals with the Polish comma', () => {
    expect(text(available(12.5, 30, 'ml'))).toContain('ok. 12,5 ml');
  });

  it('says less than one day when some stock is left but not a full day', () => {
    expect(text(available(0.5, 0))).toContain('wystarczy na mniej niż 1 dzień');
  });

  it('says the stock is used up when it is exactly zero, which is not the same as unavailable', () => {
    const result = text(available(0, 0));

    expect(result).toContain('Zapas wyczerpany (0 tabletek).');
    expect(result).not.toContain('Szacunek niedostępny');
    // Nothing left is also "low": the badge accompanies the words.
    expect(result).toContain('Niski zapas');
  });

  it('flags a short supply in words', () => {
    render(<StockSummary estimate={available(3, 3)} />);

    expect(screen.getByText('Niski zapas')).toBeVisible();
  });

  it('does not flag a comfortable supply', () => {
    render(<StockSummary estimate={available(70, 35)} />);

    expect(screen.queryByText('Niski zapas')).not.toBeInTheDocument();
  });

  it.each<[StockUnavailableReason, string]>([
    ['no-stock', 'zapas nie został skonfigurowany.'],
    ['invalid-data', 'zapisane dane zapasu są nieprawidłowe.'],
    ['ended', 'lek został zakończony.'],
    ['no-schedule', 'lek nie ma harmonogramu.'],
    ['incompatible-units', 'jednostka zapasu różni się od jednostki dawki.'],
  ])('says the estimate is unavailable, and why, for %s, with no number at all', (reason, why) => {
    const result = text({ available: false, reason });

    expect(result).toContain('Szacunek niedostępny');
    expect(result).toContain(why);
    expect(result).not.toMatch(/\d/);
  });

  it('never flags an unavailable estimate as low', () => {
    render(<StockSummary estimate={{ available: false, reason: 'no-stock' }} />);

    expect(screen.queryByText('Niski zapas')).not.toBeInTheDocument();
  });

  it('says it is calculating while the history loads, and unavailable if it could not load', () => {
    expect(text('loading')).toBe('Obliczanie zapasu…');
    const failed = text('failed');
    expect(failed).toContain('Szacunek niedostępny');
    expect(failed).not.toMatch(/\d/);
  });
});
