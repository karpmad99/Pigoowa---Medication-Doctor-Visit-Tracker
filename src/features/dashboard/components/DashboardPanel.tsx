import type { ReactNode } from 'react';
import { ModuleCard } from '@/components/ui/ModuleCard';

interface DashboardPanelProps {
  title: string;
  /** One line under the title (for example today's date). */
  description?: string;
  children: ReactNode;
}

/**
 * One panel of the dashboard: a module card (a labelled region with its own heading). The panels do
 * not depend on each other, so a panel that fails or is still loading never hides the others.
 */
export function DashboardPanel({ title, description, children }: DashboardPanelProps) {
  return (
    <ModuleCard title={title} description={description}>
      {children}
    </ModuleCard>
  );
}
