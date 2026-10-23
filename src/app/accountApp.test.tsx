import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { createFakeAuth, createFakeProfiles, makeUser, type FakeAuth } from '@/test/authFakes';
import { createFakeStorage, type FakeStorage } from '@/test/fakeStorage';
import { makeMedication } from '@/test/fixtures';
import { createTestServices } from '@/test/services';
import type { AppServices } from '@/services/repositories';
import { AccountAppProvider } from './accountApp';
import type { AccountAppDependencies } from './accountAppContext';
import { accountRoutes } from './accountRoutes';

// The whole account build — sign-in pages, session gate, application shell — with the real screens and the
// real routes, over a fake authentication service and one fake storage PER ACCOUNT. What is proved here is the
// behaviour of the screens (who sees what, when); that the real Supabase answers the same way is proved by
// the tests in supabase/tests/client and by the account end-to-end tests (e2e-accounts).

const PASSWORD = 'tajne-haslo-1';

interface Setup {
  auth: FakeAuth;
  storages: Map<string, FakeStorage>;
  accountServicesCreated: string[];
  demoStorage: FakeStorage;
  demoServicesCreated: { count: number };
  router: ReturnType<typeof createMemoryRouter>;
  onSessionLostCallbacks: Map<string, () => void>;
  tabStorage: FakeStorage;
}

function setup(
  options: {
    path?: string;
    storedEmail?: string;
    accounts?: string[];
    tabStorage?: FakeStorage;
  } = {},
): Setup {
  const auth = createFakeAuth({
    storedUser: options.storedEmail ? makeUser(options.storedEmail) : null,
  });
  for (const email of options.accounts ?? ['ala@example.com', 'ola@example.com']) {
    auth.accounts.set(email, { password: PASSWORD, user: makeUser(email) });
  }
  const profiles = createFakeProfiles();
  const storages = new Map<string, FakeStorage>();
  const accountServicesCreated: string[] = [];
  const onSessionLostCallbacks = new Map<string, () => void>();
  const demoStorage = createFakeStorage();
  const demoServicesCreated = { count: 0 };
  const tabStorage = options.tabStorage ?? createFakeStorage();

  const dependencies: AccountAppDependencies = {
    createAccountServices: ({ userId, onSessionLost }): AppServices => {
      accountServicesCreated.push(userId);
      onSessionLostCallbacks.set(userId, onSessionLost);
      let storage = storages.get(userId);
      if (!storage) {
        storage = createFakeStorage();
        storages.set(userId, storage);
      }
      return createTestServices(storage);
    },
    createDemoServices: () => {
      demoServicesCreated.count += 1;
      return createTestServices(demoStorage);
    },
  };
  const router = createMemoryRouter(accountRoutes, { initialEntries: [options.path ?? '/'] });
  render(
    <AuthProvider api={auth} profiles={profiles} browserTimeZone="Europe/Warsaw">
      <AccountAppProvider dependencies={dependencies} tabStorage={tabStorage}>
        <RouterProvider router={router} />
      </AccountAppProvider>
    </AuthProvider>,
  );
  return {
    auth,
    storages,
    accountServicesCreated,
    demoStorage,
    demoServicesCreated,
    router,
    onSessionLostCallbacks,
    tabStorage,
  };
}

async function seedMedication(services: AppServices, name: string, id: string) {
  await services.repositories.medications.create(makeMedication({ id, name }));
}

async function signInWith(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  password = PASSWORD,
) {
  await user.type(await screen.findByLabelText(/Adres e-mail/), email);
  await user.type(screen.getByLabelText(/^Hasło/), password);
  await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));
}

describe('the account build: the gate', () => {
  it('sends a signed-out visitor to the sign-in page and reads no data on the way', async () => {
    const { accountServicesCreated, router } = setup({ path: '/medications' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Logowanie' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(accountServicesCreated).toEqual([]);
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).not.toBeInTheDocument();
  });

  it('after signing in, goes to the page the visitor first asked for', async () => {
    const user = userEvent.setup();
    const { router } = setup({ path: '/appointments' });

    await signInWith(user, 'ala@example.com');

    expect(await screen.findByRole('heading', { level: 1, name: 'Wizyty' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/appointments');
  });

  it('ignores a "from" address that points outside the application', async () => {
    const user = userEvent.setup();
    const auth = createFakeAuth();
    auth.accounts.set('ala@example.com', { password: PASSWORD, user: makeUser('ala@example.com') });
    const router = createMemoryRouter(accountRoutes, {
      initialEntries: [{ pathname: '/login', state: { from: '//evil.example/steal' } }],
    });
    render(
      <AuthProvider api={auth} profiles={createFakeProfiles()} browserTimeZone="Europe/Warsaw">
        <AccountAppProvider
          tabStorage={createFakeStorage()}
          dependencies={{
            createAccountServices: () => createTestServices(),
            createDemoServices: () => createTestServices(),
          }}
        >
          <RouterProvider router={router} />
        </AccountAppProvider>
      </AuthProvider>,
    );

    await signInWith(user, 'ala@example.com');

    await screen.findByRole('heading', { level: 1, name: 'Pulpit' });
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows the account bar instead of the demonstration banner, and no migration notice', async () => {
    setup({ storedEmail: 'ala@example.com' });

    const bar = await screen.findByRole('region', { name: 'Konto' });

    expect(within(bar).getByText('ala@example.com')).toBeInTheDocument();
    expect(within(bar).getByText(/Nie wpisuj prawdziwych danych/)).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Informacja o wersji demonstracyjnej' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Aktualizacja danych w przeglądarce' }),
    ).not.toBeInTheDocument();
  });

  it('opens the application only after the profile exists, and says so when it cannot be read', async () => {
    const user = userEvent.setup();
    const auth = createFakeAuth({ storedUser: makeUser('ala@example.com') });
    const profiles = createFakeProfiles();
    profiles.failWith = 'network-error';
    const created: string[] = [];
    const router = createMemoryRouter(accountRoutes, { initialEntries: ['/'] });
    render(
      <AuthProvider api={auth} profiles={profiles} browserTimeZone="Europe/Warsaw">
        <AccountAppProvider
          tabStorage={createFakeStorage()}
          dependencies={{
            createAccountServices: ({ userId }) => {
              created.push(userId);
              return createTestServices();
            },
            createDemoServices: () => createTestServices(),
          }}
        >
          <RouterProvider router={router} />
        </AccountAppProvider>
      </AuthProvider>,
    );

    expect(await screen.findByText('Nie udało się otworzyć konta')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Nie można połączyć się z serwerem');
    expect(created).toEqual([]);

    profiles.failWith = null;
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pulpit' })).toBeInTheDocument();
    expect(created).toEqual(['user-ala@example.com']);
  });
});

describe('the account build: sign-in errors', () => {
  it('says "wrong e-mail or password" without saying which, and keeps the typed e-mail', async () => {
    const user = userEvent.setup();
    setup();

    await signInWith(user, 'ala@example.com', 'zle-haslo-123');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nieprawidłowy adres e-mail lub hasło.',
    );
    expect(screen.getByLabelText(/Adres e-mail/)).toHaveValue('ala@example.com');
    expect(screen.getByRole('heading', { level: 1, name: 'Logowanie' })).toBeInTheDocument();
  });

  it('says that the server cannot be reached, and signs in once it can, from the same form', async () => {
    const user = userEvent.setup();
    const { auth } = setup();
    auth.failWith = 'network-error';

    await signInWith(user, 'ala@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie można połączyć się z serwerem');

    auth.failWith = null;
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pulpit' })).toBeInTheDocument();
  });

  it('validates the form before asking the server', async () => {
    const user = userEvent.setup();
    const { auth } = setup();

    await user.click(await screen.findByRole('button', { name: 'Zaloguj się' }));
    expect(await screen.findByText('Wpisz adres e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Wpisz hasło.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Adres e-mail/), 'to-nie-jest-adres');
    await user.type(screen.getByLabelText(/^Hasło/), 'x');
    await user.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect(await screen.findByText(/Wpisz poprawny adres e-mail/)).toBeInTheDocument();
    expect(auth.calls.signIn).toBe(0);
  });

  it('tells a visitor whose session ended that it expired', async () => {
    const { auth } = setup({ storedEmail: 'ala@example.com' });
    await screen.findByRole('heading', { level: 1, name: 'Pulpit' });

    auth.emit('signed-out', null);

    expect(await screen.findByRole('heading', { level: 1, name: 'Logowanie' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sesja wygasła');
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).not.toBeInTheDocument();
  });

  it('does the same when a data operation reports that the session is gone', async () => {
    const { onSessionLostCallbacks } = setup({ storedEmail: 'ala@example.com' });
    await screen.findByRole('heading', { level: 1, name: 'Pulpit' });

    onSessionLostCallbacks.get('user-ala@example.com')?.();

    expect(await screen.findByRole('heading', { level: 1, name: 'Logowanie' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sesja wygasła');
  });
});

describe('the account build: whose data', () => {
  it('shows each account only its own data, also after signing out and in as another user', async () => {
    const user = userEvent.setup();
    const { storages } = setup();

    await signInWith(user, 'ala@example.com');
    await screen.findByRole('heading', { level: 1, name: 'Pulpit' });
    const alaServices = createTestServices(storages.get('user-ala@example.com'));
    await seedMedication(alaServices, 'Lek Ali', 'm-ala');
    await user.click(screen.getByRole('link', { name: 'Leki' }));
    expect((await screen.findAllByText('Lek Ali')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Wyloguj się' }));
    await screen.findByRole('heading', { level: 1, name: 'Logowanie' });
    expect(screen.queryByText('Lek Ali')).not.toBeInTheDocument();

    await signInWith(user, 'ola@example.com');
    // She lands on the page the first visitor was on (the address is remembered); the data is her own.
    await screen.findByRole('heading', { level: 1, name: 'Leki' });
    expect(await screen.findByText('Nie dodano jeszcze żadnego leku')).toBeInTheDocument();
    expect(screen.queryByText('Lek Ali')).not.toBeInTheDocument();
  });

  it('makes new services for a different user and keeps the same ones for the same user', async () => {
    const user = userEvent.setup();
    const { accountServicesCreated } = setup();

    await signInWith(user, 'ala@example.com');
    await screen.findByRole('heading', { level: 1, name: 'Pulpit' });
    await user.click(screen.getByRole('link', { name: 'Leki' }));
    await user.click(screen.getByRole('link', { name: 'Wizyty' }));
    expect(accountServicesCreated).toEqual(['user-ala@example.com']);

    await user.click(screen.getByRole('button', { name: 'Wyloguj się' }));
    await screen.findByRole('heading', { level: 1, name: 'Logowanie' });
    await signInWith(user, 'ola@example.com');
    // She lands on the page the first visitor was sent away from; what matters is that it is hers.
    await screen.findByRole('heading', { level: 1, name: 'Wizyty' });

    expect(accountServicesCreated).toEqual(['user-ala@example.com', 'user-ola@example.com']);
  });

  it('reports a failed sign-out and keeps the user signed in', async () => {
    const user = userEvent.setup();
    const { auth } = setup({ storedEmail: 'ala@example.com' });
    await screen.findByRole('heading', { level: 1, name: 'Pulpit' });
    auth.failWith = 'unknown';

    await user.click(screen.getByRole('button', { name: 'Wyloguj się' }));

    expect(
      await screen.findByText('Nie udało się wylogować. Spróbuj ponownie.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pulpit' })).toBeInTheDocument();
  });
});

describe('the account build: the demonstration stays available', () => {
  it('opens the demonstration from the sign-in page, with its banner, and never makes account services', async () => {
    const user = userEvent.setup();
    const { accountServicesCreated, demoServicesCreated } = setup();

    await user.click(await screen.findByRole('button', { name: 'Wypróbuj wersję demonstracyjną' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pulpit' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Informacja o wersji demonstracyjnej' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Konto' })).not.toBeInTheDocument();
    expect(accountServicesCreated).toEqual([]);
    expect(demoServicesCreated.count).toBe(1);
  });

  it('keeps the demonstration data in the demonstration storage, apart from every account', async () => {
    const user = userEvent.setup();
    const { demoStorage, storages } = setup();
    await seedMedication(createTestServices(demoStorage), 'Lek demo', 'm-demo');

    await user.click(await screen.findByRole('button', { name: 'Wypróbuj wersję demonstracyjną' }));
    await screen.findByRole('heading', { level: 1, name: 'Pulpit' });
    await user.click(screen.getByRole('link', { name: 'Leki' }));
    expect((await screen.findAllByText('Lek demo')).length).toBeGreaterThan(0);

    await user.click(
      screen.getByRole('button', { name: 'Wyjdź z wersji demonstracyjnej i zaloguj się' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Logowanie' });
    await signInWith(user, 'ala@example.com');
    await screen.findByRole('heading', { level: 1, name: 'Leki' });
    await waitFor(() => {
      expect(screen.queryByText('Lek demo')).not.toBeInTheDocument();
    });
    // The demonstration's data was not copied into the account, and the account's storage holds none of it.
    expect(
      storages.get('user-ala@example.com')?.getItem('pigoowa:v1:medications') ?? null,
    ).toBeNull();
    expect(demoStorage.getItem('pigoowa:v1:medications')).not.toBeNull();
  });

  it('remembers the choice for this tab, so a reload stays in the demonstration', async () => {
    const user = userEvent.setup();
    const first = setup();
    await user.click(await screen.findByRole('button', { name: 'Wypróbuj wersję demonstracyjną' }));
    await screen.findByRole('heading', { level: 1, name: 'Pulpit' });
    expect(first.tabStorage.getItem('pigoowa:session-mode')).toBe('demo');
    document.body.innerHTML = '';

    // The same tab, loaded again: the storage of the tab is what is kept.
    const second = setup({ path: '/medications', tabStorage: first.tabStorage });

    expect(await screen.findByRole('heading', { level: 1, name: 'Leki' })).toBeInTheDocument();
    expect(second.demoServicesCreated.count).toBe(1);
  });
});

describe('the account build: sign-up', () => {
  it('checks the password before asking the server', async () => {
    const user = userEvent.setup();
    const { auth } = setup({ path: '/register' });

    await user.type(await screen.findByLabelText(/Adres e-mail/), 'nowy@example.com');
    await user.type(screen.getByLabelText(/^Hasło/), 'krotkie');
    await user.type(screen.getByLabelText(/Powtórz hasło/), 'inne');
    await user.click(screen.getByRole('button', { name: 'Załóż konto' }));

    expect(await screen.findByText('Hasło musi mieć co najmniej 8 znaków.')).toBeInTheDocument();
    expect(screen.getByText('Hasła nie są takie same.')).toBeInTheDocument();
    expect(auth.calls.signUp).toBe(0);
  });

  it('creates the account, signs in and opens the application', async () => {
    const user = userEvent.setup();
    const { auth } = setup({ path: '/register' });

    await user.type(await screen.findByLabelText(/Adres e-mail/), 'nowy@example.com');
    await user.type(screen.getByLabelText(/^Hasło/), 'dlugie-haslo-1');
    await user.type(screen.getByLabelText(/Powtórz hasło/), 'dlugie-haslo-1');
    await user.click(screen.getByRole('button', { name: 'Załóż konto' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Pulpit' })).toBeInTheDocument();
    expect(auth.calls.signUp).toBe(1);
    expect(screen.getByText('nowy@example.com')).toBeInTheDocument();
  });

  it('says so when the e-mail address is already taken', async () => {
    const user = userEvent.setup();
    setup({ path: '/register' });

    await user.type(await screen.findByLabelText(/Adres e-mail/), 'ala@example.com');
    await user.type(screen.getByLabelText(/^Hasło/), 'dlugie-haslo-1');
    await user.type(screen.getByLabelText(/Powtórz hasło/), 'dlugie-haslo-1');
    await user.click(screen.getByRole('button', { name: 'Załóż konto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Konto z tym adresem e-mail już istnieje',
    );
  });

  it('asks to confirm the e-mail address when the server wants that, and does not sign in', async () => {
    const user = userEvent.setup();
    const { auth } = setup({ path: '/register' });
    auth.requireConfirmation = true;

    await user.type(await screen.findByLabelText(/Adres e-mail/), 'nowy@example.com');
    await user.type(screen.getByLabelText(/^Hasło/), 'dlugie-haslo-1');
    await user.type(screen.getByLabelText(/Powtórz hasło/), 'dlugie-haslo-1');
    await user.click(screen.getByRole('button', { name: 'Załóż konto' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sprawdź skrzynkę' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Przejdź do logowania' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).not.toBeInTheDocument();
  });

  it('reports a network failure on sign-up and keeps the typed values', async () => {
    const user = userEvent.setup();
    const { auth } = setup({ path: '/register' });
    auth.failWith = 'network-error';

    await user.type(await screen.findByLabelText(/Adres e-mail/), 'nowy@example.com');
    await user.type(screen.getByLabelText(/^Hasło/), 'dlugie-haslo-1');
    await user.type(screen.getByLabelText(/Powtórz hasło/), 'dlugie-haslo-1');
    await user.click(screen.getByRole('button', { name: 'Załóż konto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie można połączyć się z serwerem');
    expect(screen.getByLabelText(/Adres e-mail/)).toHaveValue('nowy@example.com');
  });
});

vi.setConfig({ testTimeout: 15_000 });
