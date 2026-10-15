import { PlaceholderPage } from '@/components/layout/PlaceholderPage';
import { usePageTitle } from '@/hooks/usePageTitle';

export function DashboardPage() {
  usePageTitle(null);
  return (
    <PlaceholderPage
      title="Pulpit"
      description="Dzisiejsze dawki, najbliższe wizyty i stan zapasów w jednym miejscu."
      icon="dashboard"
      upcoming="Pojawią się tu dzisiejsze dawki do potwierdzenia, najbliższe wizyty u lekarzy i podsumowanie zapasów leków."
    />
  );
}
