import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';

/** The frame of the sign-in and sign-up pages: they are outside the application shell (no navigation, no data). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:py-16">
      <header className="mb-8 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-control bg-brand-600 text-white"
        >
          <Icon name="pill" />
        </span>
        <span className="text-2xl font-semibold tracking-tight">Pigoowa</span>
      </header>
      <main id="main-content" className="w-full max-w-md space-y-6">
        {children}
      </main>
    </div>
  );
}
