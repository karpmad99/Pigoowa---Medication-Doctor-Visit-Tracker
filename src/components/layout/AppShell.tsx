import { NavLink, Outlet } from 'react-router';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAppMode } from '@/app/appMode';
import { AccountBar } from './AccountBar';
import { DemoBanner } from './DemoBanner';
import { MigrationNotice } from './MigrationNotice';
import { SafetyNote } from './SafetyNote';

const navigationItems: readonly {
  to: string;
  label: string;
  icon: IconName;
  end: boolean;
}[] = [
  { to: '/', label: 'Pulpit', icon: 'dashboard', end: true },
  { to: '/doses', label: 'Dawki', icon: 'clock', end: false },
  { to: '/medications', label: 'Leki', icon: 'pill', end: false },
  { to: '/appointments', label: 'Wizyty', icon: 'calendar', end: false },
];

// One <nav> serves both layouts, so assistive technology never meets duplicate navigation:
// a bar fixed to the bottom of the screen on phones, a vertical list in the sidebar from the
// "md" breakpoint (768 px) up. The current page is marked by aria-current (set by NavLink),
// and styled with an accent bar and bolder text, not by colour alone.
const navLinkClasses =
  'flex min-h-14 flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium ' +
  'text-ink-muted hover:bg-canvas hover:text-ink ' +
  'aria-[current=page]:font-semibold aria-[current=page]:text-brand-700 ' +
  'aria-[current=page]:shadow-[inset_0_3px_0_0_var(--color-brand-600)] ' +
  'md:min-h-11 md:flex-row md:justify-start md:gap-3 md:rounded-control md:px-3 md:text-sm ' +
  'md:aria-[current=page]:bg-brand-50 ' +
  'md:aria-[current=page]:shadow-[inset_3px_0_0_0_var(--color-brand-600)]';

export function AppShell() {
  const mode = useAppMode();
  return (
    <div className="flex min-h-dvh flex-col md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-brand-700 focus:shadow-lg"
      >
        Przejdź do treści
      </a>

      <header className="sticky top-0 z-20 border-b border-line bg-surface md:flex md:h-dvh md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-4 py-3 md:px-5 md:py-6">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-control bg-brand-600 text-white"
          >
            <Icon name="pill" />
          </span>
          <span className="text-xl font-semibold tracking-tight">Pigoowa</span>
        </div>
        <nav
          aria-label="Główna nawigacja"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface md:static md:border-t-0 md:px-3"
        >
          <ul className="grid grid-cols-4 md:grid-cols-1 md:gap-1">
            {navigationItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={navLinkClasses}>
                  <Icon name={item.icon} />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* flex-1 makes this column fill the space under the top bar, so short pages do not scroll. */}
      <div className="flex flex-1 flex-col">
        {mode.kind === 'demo' ? (
          <>
            <DemoBanner />
            <MigrationNotice />
          </>
        ) : (
          <AccountBar />
        )}
        {/* tabIndex -1 lets the skip link move keyboard focus here without adding a tab stop. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 focus:outline-none sm:px-6 md:px-8 md:pt-10"
        >
          <Outlet />
        </main>
        <footer className="mx-auto w-full max-w-4xl px-4 pb-24 pt-8 sm:px-6 md:px-8 md:pb-8">
          <SafetyNote />
        </footer>
      </div>
    </div>
  );
}
