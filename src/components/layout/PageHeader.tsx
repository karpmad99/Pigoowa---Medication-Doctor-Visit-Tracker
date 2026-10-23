import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** One sentence saying what the page is for. */
  description?: string;
  /** Primary actions for the page (e.g. an "add" button). Stacks under the title on phones. */
  actions?: ReactNode;
}

/** The consistent top of every page: the one <h1>, a short description and optional actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-lg text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
