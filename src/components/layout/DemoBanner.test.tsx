import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DemoBanner } from './DemoBanner';

describe('DemoBanner', () => {
  it('says the data is fictional, kept only in this browser, not encrypted, and not for real medical data', () => {
    render(<DemoBanner />);

    const note = screen.getByRole('region', { name: 'Informacja o wersji demonstracyjnej' });
    expect(note).toHaveTextContent('Wersja demonstracyjna: dane fikcyjne.');
    expect(note).toHaveTextContent('tylko w tej przeglądarce');
    expect(note).toHaveTextContent('localStorage');
    expect(note).toHaveTextContent('nie są szyfrowane');
    expect(note).toHaveTextContent('Nie wpisuj prawdziwych danych medycznych ani osobowych');
  });

  it('cannot be dismissed: it has no controls', () => {
    render(<DemoBanner />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
