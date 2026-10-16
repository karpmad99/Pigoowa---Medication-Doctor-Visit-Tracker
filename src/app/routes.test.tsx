import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from './ServicesProvider';
import { createTestServices } from '@/test/services';
import { routes } from './routes';

function renderAppAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  // The medications page reads its data through the services, so the app needs a provider.
  render(
    <ServicesProvider services={createTestServices()}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  );
  return router;
}

describe('application routes', () => {
  it('shows the dashboard at the root path', () => {
    renderAppAt('/');

    expect(screen.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeInTheDocument();
  });

  it('offers navigation to the three main sections and marks the current one', () => {
    renderAppAt('/');

    const navigation = screen.getByRole('navigation', { name: 'Główna nawigacja' });
    expect(navigation).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pulpit' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Leki' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Wizyty' })).toBeInTheDocument();
  });

  it('navigates between sections using the navigation links', async () => {
    const user = userEvent.setup();
    const router = renderAppAt('/');

    await user.click(screen.getByRole('link', { name: 'Leki' }));
    expect(router.state.location.pathname).toBe('/medications');
    expect(screen.getByRole('heading', { level: 1, name: 'Leki' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Leki' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: 'Wizyty' }));
    expect(router.state.location.pathname).toBe('/appointments');
    expect(screen.getByRole('heading', { level: 1, name: 'Wizyty' })).toBeInTheDocument();
  });

  it('shows a not-found page with a way back for unknown addresses', async () => {
    const user = userEvent.setup();
    renderAppAt('/does-not-exist');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Nie znaleziono strony' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Wróć do pulpitu' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeInTheDocument();
  });

  it('provides a skip link to the main content', () => {
    renderAppAt('/');

    expect(screen.getByRole('link', { name: 'Przejdź do treści' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });
});
