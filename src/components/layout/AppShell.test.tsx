import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/app/ServicesProvider';
import { routes } from '@/app/routes';
import { createTestServices } from '@/test/services';

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

describe('AppShell landmarks', () => {
  it('provides the page regions assistive technology navigates by', () => {
    renderAppAt('/');

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('has exactly one navigation, so there is no duplicate menu for mobile and desktop', () => {
    renderAppAt('/');

    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('names the application', () => {
    renderAppAt('/');

    expect(within(screen.getByRole('banner')).getByText('Pigoowa')).toBeInTheDocument();
  });

  it('shows the safety note on every page', () => {
    renderAppAt('/medications');

    expect(
      within(screen.getByRole('contentinfo')).getByText(/nie zastępuje zaleceń lekarza/),
    ).toBeInTheDocument();
  });

  it('makes the skip link the very first thing the keyboard reaches', async () => {
    renderAppAt('/');

    await userEvent.setup().tab();

    expect(screen.getByRole('link', { name: 'Przejdź do treści' })).toHaveFocus();
  });
});

describe('AppShell navigation', () => {
  it('links to the three sections with real addresses', () => {
    renderAppAt('/');
    const navigation = screen.getByRole('navigation', { name: 'Główna nawigacja' });

    expect(within(navigation).getByRole('link', { name: 'Pulpit' })).toHaveAttribute('href', '/');
    expect(within(navigation).getByRole('link', { name: 'Leki' })).toHaveAttribute(
      'href',
      '/medications',
    );
    expect(within(navigation).getByRole('link', { name: 'Wizyty' })).toHaveAttribute(
      'href',
      '/appointments',
    );
    expect(within(navigation).queryAllByRole('button')).toHaveLength(0);
  });

  it.each([
    ['/', 'Pulpit'],
    ['/doses', 'Dawki'],
    ['/doses/history', 'Dawki'],
    ['/medications', 'Leki'],
    ['/appointments', 'Wizyty'],
  ])('marks only the current page (%s) as current', (path, currentLabel) => {
    renderAppAt(path);

    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual([currentLabel]);
  });

  it('keeps the section marked as current for nested addresses only where it should', () => {
    renderAppAt('/does-not-exist');

    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    expect(links.some((link) => link.getAttribute('aria-current') === 'page')).toBe(false);
  });

  it('can be operated with the keyboard alone', async () => {
    const router = renderAppAt('/');
    const user = userEvent.setup();

    await user.tab(); // skip link
    await user.tab(); // Pulpit
    await user.tab(); // Dawki
    await user.tab(); // Leki
    expect(screen.getByRole('link', { name: 'Leki' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(router.state.location.pathname).toBe('/medications');
  });
});

describe('page titles', () => {
  it('names the tab after the current page and returns to the plain app name on the home page', async () => {
    const user = userEvent.setup();
    renderAppAt('/');
    expect(document.title).toBe('Pigoowa');

    await user.click(screen.getByRole('link', { name: 'Leki' }));
    expect(document.title).toBe('Leki – Pigoowa');

    await user.click(screen.getByRole('link', { name: 'Wizyty' }));
    expect(document.title).toBe('Wizyty – Pigoowa');

    await user.click(screen.getByRole('link', { name: 'Pulpit' }));
    expect(document.title).toBe('Pigoowa');
  });

  it('titles the not-found page', () => {
    renderAppAt('/nie-ma-takiej-strony');

    expect(document.title).toBe('Nie znaleziono strony – Pigoowa');
  });
});

describe('section pages', () => {
  // `/medications` and `/appointments` are no longer placeholders: stages 5 and 7 replaced them
  // with the real screens (see src/pages/MedicationsPage.test.tsx and AppointmentsPage.test.tsx).
  // The sections still to be built are listed here.
  it.each([['/', 'Pulpit']])(
    '%s says plainly that its content is not built yet and offers no fake controls',
    (path, title) => {
      renderAppAt(path);

      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Ta sekcja jest jeszcze w budowie' }),
      ).toBeInTheDocument();
      expect(within(screen.getByRole('main')).queryAllByRole('button')).toHaveLength(0);
    },
  );

  it('has a single level-one heading per page', () => {
    renderAppAt('/medications');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('development-only component preview', () => {
  it('is reachable in development and tests', async () => {
    renderAppAt('/dev/components');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Podgląd komponentów' }),
    ).toBeInTheDocument();
  });
});
