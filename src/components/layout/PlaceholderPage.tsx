import { EmptyState } from '@/components/ui/EmptyState';
import type { IconName } from '@/components/ui/Icon';
import { PageHeader } from './PageHeader';

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: IconName;
  /** What will appear here, in plain words. */
  upcoming: string;
}

/**
 * A section whose content is built in a later stage. It says so plainly and offers no fake
 * controls; the real page replaces this component.
 */
export function PlaceholderPage({ title, description, icon, upcoming }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title="Ta sekcja jest jeszcze w budowie" description={upcoming} />
    </>
  );
}
