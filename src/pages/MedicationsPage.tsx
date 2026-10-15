import { PlaceholderPage } from '@/components/layout/PlaceholderPage';
import { usePageTitle } from '@/hooks/usePageTitle';

export function MedicationsPage() {
  usePageTitle('Leki');
  return (
    <PlaceholderPage
      title="Leki"
      description="Twoje leki, harmonogramy dawkowania i historia przyjmowania."
      icon="pill"
      upcoming="Pojawi się tu lista leków z harmonogramem i zapasem oraz możliwość dodawania i edytowania leków."
    />
  );
}
