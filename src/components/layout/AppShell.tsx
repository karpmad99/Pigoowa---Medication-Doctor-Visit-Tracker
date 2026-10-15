import { NavLink, Outlet } from 'react-router';

const navigationItems = [
  { to: '/', label: 'Pulpit', end: true },
  { to: '/medications', label: 'Leki', end: false },
  { to: '/appointments', label: 'Wizyty', end: false },
] as const;

export function AppShell() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Przejdź do treści
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
          <span className="text-xl font-semibold text-teal-700">Pigoowa</span>
          <nav aria-label="Główna nawigacja">
            <ul className="flex gap-1">
              {navigationItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      [
                        'block rounded-md px-3 py-2 text-sm font-medium',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700',
                        isActive ? 'bg-teal-50 text-teal-800' : 'text-slate-700 hover:bg-slate-100',
                      ].join(' ')
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
