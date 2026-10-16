import { useId, type ReactNode } from 'react';

interface DashboardPanelProps {
  title: string;
  /** One line under the title (for example today's date). */
  description?: string;
  children: ReactNode;
}

/**
 * One panel of the dashboard: a labelled region with its own heading. The panels do not depend on
 * each other, so a panel that fails or is still loading never hides the others.
 */
export function DashboardPanel({ title, description, children }: DashboardPanelProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div>
        <h2 id={headingId} className="text-xl font-semibold">
          {title}
        </h2>
        {description !== undefined && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
