import { useId, type ReactNode } from 'react';

interface ModuleCardProps {
  title: string;
  /** One line under the title (for example today's date). */
  description?: string;
  children: ReactNode;
}

/**
 * One module of a screen (today's doses, the stock, the appointments): a labelled region drawn as a
 * card with a darker border and a large heading, so the modules are told apart at a glance. The
 * rows inside it are lighter (canvas background, the ordinary border) and so never look like
 * another card.
 */
export function ModuleCard({ title, description, children }: ModuleCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-card border border-line-card bg-surface p-4 sm:p-6"
    >
      <div>
        <h2 id={headingId} className="text-2xl font-semibold tracking-tight">
          {title}
        </h2>
        {description !== undefined && <p className="text-base text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
