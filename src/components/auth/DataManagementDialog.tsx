import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { exportUserData } from '@/features/auth/export';
import { useServices } from '@/hooks/useServices';

export function DataManagementDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const services = useServices();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Zarządzanie danymi"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Zamknij
          </Button>
        </>
      }
    >
      <p>Możesz pobrać pełną kopię swoich danych w formacie JSON.</p>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <Button
          variant="secondary"
          isLoading={isExporting}
          onClick={async () => {
            if (!services) return;
            setError(null);
            setIsExporting(true);
            const result = await exportUserData(services.repositories);
            setIsExporting(false);
            if (!result.ok) setError(result.error ?? 'Błąd eksportu');
          }}
        >
          Pobierz moje dane (JSON)
        </Button>
      </div>
    </Dialog>
  );
}
