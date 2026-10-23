import { useState } from 'react';
import { useAppMode } from '@/app/appMode';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { DataManagementDialog } from '@/components/auth/DataManagementDialog';

/**
 * Shown on every page of a signed-in account instead of the demonstration banner: whose data this is, how to
 * sign out, and — until the privacy review of ROADMAP Stage 12 is done — that real medical data does not
 * belong here yet.
 */
export function AccountBar() {
  const mode = useAppMode();
  const [failed, setFailed] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDataDialogOpen, setIsDataDialogOpen] = useState(false);

  if (mode.kind !== 'account') return null;
  const { signOut } = mode;

  return (
    <section
      aria-label="Konto"
      className="border-b border-line bg-surface px-4 py-3 text-sm sm:px-6 md:px-8"
    >
      <DataManagementDialog
        isOpen={isDataDialogOpen}
        onClose={() => setIsDataDialogOpen(false)}
      />
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            Zalogowano jako <strong>{mode.email}</strong>
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsDataDialogOpen(true)}
            >
              Zarządzaj danymi
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={isSigningOut}
              onClick={() => {
                setFailed(false);
                setIsSigningOut(true);
                void signOut().then((result) => {
                  setIsSigningOut(false);
                  setFailed(!result.ok);
                });
              }}
            >
              Wyloguj się
            </Button>
          </div>
        </div>
        {failed && (
          <p role="alert" className="font-medium text-danger-700">
            Nie udało się wylogować. Spróbuj ponownie.
          </p>
        )}
        <p className="flex gap-2 text-warning-800">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Wersja rozwojowa.</strong> Dane tego konta są zapisywane na serwerze, ale
            polityka prywatności i przegląd bezpieczeństwa nie są jeszcze gotowe. Nie wpisuj
            prawdziwych danych medycznych ani osobowych.
          </span>
        </p>
      </div>
    </section>
  );
}
