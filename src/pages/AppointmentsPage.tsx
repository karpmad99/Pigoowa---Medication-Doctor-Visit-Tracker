import { PlaceholderPage } from '@/components/layout/PlaceholderPage';
import { usePageTitle } from '@/hooks/usePageTitle';

export function AppointmentsPage() {
  usePageTitle('Wizyty');
  return (
    <PlaceholderPage
      title="Wizyty"
      description="Nadchodzące i minione wizyty u lekarzy."
      icon="calendar"
      upcoming="Pojawi się tu lista nadchodzących i minionych wizyt oraz możliwość ich dodawania i oznaczania jako odbyte lub odwołane."
    />
  );
}
