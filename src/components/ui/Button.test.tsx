import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ButtonLink } from './ButtonLink';

describe('Button', () => {
  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Zapisz</Button>);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a plain button by default, so inside a form it does not submit the form', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button>Anuluj</Button>
        <Button type="submit">Zapisz</Button>
      </form>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Usuń
      </Button>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Usuń' }));

    expect(screen.getByRole('button', { name: 'Usuń' })).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('while loading is disabled, marked busy, and ignores repeated clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        Zapisywanie…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Zapisywanie…' });

    await userEvent.setup().click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not marked busy when not loading', () => {
    render(<Button>Zapisz</Button>);

    expect(screen.getByRole('button', { name: 'Zapisz' })).not.toHaveAttribute('aria-busy');
  });

  it('can be reached and activated with the keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Zapisz</Button>);
    const user = userEvent.setup();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Zapisz' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('ButtonLink', () => {
  it('is a real link that navigates through the router', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <ButtonLink to="/leki">Przejdź do leków</ButtonLink> },
        { path: '/leki', element: <p>Strona leków</p> },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);

    const link = screen.getByRole('link', { name: 'Przejdź do leków' });
    expect(link).toHaveAttribute('href', '/leki');
    await userEvent.setup().click(link);

    expect(router.state.location.pathname).toBe('/leki');
    expect(screen.getByText('Strona leków')).toBeInTheDocument();
  });
});
