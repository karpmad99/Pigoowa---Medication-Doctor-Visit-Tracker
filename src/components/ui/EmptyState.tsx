import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  title: string;
  /** What is missing and what the user can do next. */
  description: string;
  icon?: IconName;
  /** Optional call to action, e.g. a ButtonLink. */
  action?: ReactNode;
}

export function EmptyState({ title, description, icon = 'info', action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-700">
        <Icon name={icon} className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-md text-ink-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
