import { useMemo } from 'react';
import { Navigate, useLocation } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { authFailureMessage } from '@/features/auth/authErrors';
import type { AuthState } from '@/features/auth/authContext';
import { useAuth } from '@/features/auth/useAuth';
import type { AppServices } from '@/services/repositories';
import { useAccountDependencies, useDemoChoice } from './accountAppContext';
import { AppModeContext, type AppMode } from './appMode';
import { ServicesProvider } from './ServicesProvider';

/**
 * The gate in front of the application in a build that offers accounts. It decides which services the
 * application gets, and therefore whose data it can reach:
 *
 * - the user chose the demonstration: the browser-storage services (fictional data, this browser only);
 * - signed in: the services of that account, made once for that user (a different user, or signing out and in
 *   again, gets new services and an empty query cache, so nothing of the previous account stays reachable);
 * - otherwise: nothing is shown but the sign-in page. The data pages are not rendered at all, so no request
 *   for data is made without a session. This is a convenience: what protects the data is Row Level Security
 *   in the database, not this gate.
 */
export function SessionServices() {
  const auth = useAuth();
  const demo = useDemoChoice();
  const location = useLocation();

  if (demo.isDemo) return <DemoShell />;

  const { state } = auth;
  if (state.status === 'loading') return <FullPageStatus />;
  if (state.status === 'signed-out') {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }
  if (state.status === 'profile-failed') {
    return (
      <ProfileFailed
        code={state.code}
        onRetry={auth.retryProfile}
        onSignOut={() => {
          void auth.signOut();
        }}
      />
    );
  }
  return <AccountShell state={state} />;
}

function FullPageStatus() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner label="Wczytywanie konta…" />
    </div>
  );
}

function ProfileFailed({
  code,
  onRetry,
  onSignOut,
}: {
  code: Parameters<typeof authFailureMessage>[0];
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <ErrorState
        title="Nie udało się otworzyć konta"
        message={authFailureMessage(code)}
        onRetry={onRetry}
      />
      <Button variant="secondary" onClick={onSignOut}>
        Wyloguj się
      </Button>
    </div>
  );
}

function DemoShell() {
  const { createDemoServices } = useAccountDependencies();
  const services = useMemo(() => createDemoServices(), [createDemoServices]);
  const { leaveDemo } = useDemoChoice();
  const mode: AppMode = useMemo(() => ({ kind: 'demo', leaveDemo }), [leaveDemo]);
  return (
    <ServicesProvider services={services}>
      <AppModeContext value={mode}>
        <AppShell />
      </AppModeContext>
    </ServicesProvider>
  );
}

function AccountShell({ state }: { state: Extract<AuthState, { status: 'signed-in' }> }) {
  const auth = useAuth();
  const { createAccountServices } = useAccountDependencies();
  const { sessionLost, signOut } = auth;
  const userId = state.user.id;
  const { timeZone } = state;
  const services: AppServices = useMemo(
    () => createAccountServices({ userId, timeZone, onSessionLost: sessionLost }),
    // One set of services per signed-in user: the user object is replaced on every auth event, her id is not.
    [createAccountServices, userId, timeZone, sessionLost],
  );
  const email = state.user.email;
  const mode: AppMode = useMemo(() => ({ kind: 'account', email, signOut }), [email, signOut]);
  return (
    <ServicesProvider services={services}>
      <AppModeContext value={mode}>
        <AppShell />
      </AppModeContext>
    </ServicesProvider>
  );
}
