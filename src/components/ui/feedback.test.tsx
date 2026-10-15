import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Spinner } from './Spinner';

describe('EmptyState', () => {
  it('explains what is missing and offers the next step', () => {
    render(
      <EmptyState
        title="Nie dodano jeszcze leków"
        description="Dodaj pierwszy lek, aby zobaczyć harmonogram."
        action={<Button>Dodaj lek</Button>}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Nie dodano jeszcze leków' }),
    ).toBeVisible();
    expect(screen.getByText('Dodaj pierwszy lek, aby zobaczyć harmonogram.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Dodaj lek' })).toBeEnabled();
  });

  it('renders without an action', () => {
    render(<EmptyState title="Brak wizyt" description="Nie ma zaplanowanych wizyt." />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('is announced as an alert with the message', () => {
    render(<ErrorState message="Nie udało się wczytać danych." />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Coś poszło nie tak');
    expect(alert).toHaveTextContent('Nie udało się wczytać danych.');
  });

  it('offers a working retry only when a handler is given', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState message="Błąd." />);
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).not.toBeInTheDocument();

    rerender(<ErrorState message="Błąd." onRetry={onRetry} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('Spinner', () => {
  it('announces a default and a custom loading label as a status', () => {
    const { rerender } = render(<Spinner />);
    expect(screen.getByRole('status')).toHaveTextContent('Ładowanie…');

    rerender(<Spinner label="Wczytywanie leków…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Wczytywanie leków…');
  });

  it('adds nothing for assistive technology when decorative', () => {
    render(<Spinner decorative />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('states the status in text, not only in colour', () => {
    render(<Badge tone="warning">Do potwierdzenia</Badge>);

    expect(screen.getByText('Do potwierdzenia')).toBeVisible();
  });
});
