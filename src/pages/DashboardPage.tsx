import { PageHeader } from '@/components/layout/PageHeader';
import { StockPanel } from '@/features/dashboard/components/StockPanel';
import { TodayDosesPanel } from '@/features/dashboard/components/TodayDosesPanel';
import { UpcomingAppointmentsPanel } from '@/features/dashboard/components/UpcomingAppointmentsPanel';
import { useDoseLogs } from '@/features/doses/hooks/useDoseLogs';
import { useMedications } from '@/features/medications/hooks/useMedications';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useServices } from '@/hooks/useServices';
import { EARLIEST_LOCAL_DATE, LATEST_LOCAL_DATE } from '@/utils/date';
import { getLocalDateInZone } from '@/utils/timeZone';

/**
 * The start screen: today's doses, the next appointments and the stock summary. Each panel has
 * its own loading, error and empty states, so one failing read never blanks the page. Doses and
 * stock share one read of the medications and the intake records, so marking a dose updates the
 * counts and the stock estimate together; appointments are read separately.
 */
export function DashboardPage() {
  usePageTitle(null);
  const { clock, timeZone } = useServices();
  const today = getLocalDateInZone(clock.now(), timeZone);
  const medications = useMedications();
  const doseLogs = useDoseLogs(EARLIEST_LOCAL_DATE, LATEST_LOCAL_DATE, { keepDataOnReload: true });
  const reloadDoseData = () => {
    medications.reload();
    doseLogs.reload();
  };

  return (
    <>
      <PageHeader
        title="Pulpit"
        description="Dzisiejsze dawki, najbliższe wizyty i szacunkowy stan zapasów w jednym miejscu."
      />
      <div className="space-y-10">
        <TodayDosesPanel
          medications={medications}
          doseLogs={doseLogs}
          today={today}
          timeZone={timeZone}
          onRetry={reloadDoseData}
        />
        <div className="grid gap-10 md:grid-cols-2">
          <UpcomingAppointmentsPanel />
          <StockPanel
            medications={medications}
            doseLogs={doseLogs}
            today={today}
            onRetry={reloadDoseData}
          />
        </div>
      </div>
    </>
  );
}
