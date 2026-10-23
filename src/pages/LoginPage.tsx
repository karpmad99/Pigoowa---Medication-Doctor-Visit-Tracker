import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useDemoChoice } from '@/app/accountAppContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { AccountDataNotice } from '@/features/auth/components/AuthNotice';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { authFailureMessage } from '@/features/auth/authErrors';
import type { AuthFailureCode } from '@/features/auth/types';
import { useAuth } from '@/features/auth/useAuth';
import { usePageTitle } from '@/hooks/usePageTitle';

/** Where to go after signing in: the page the user was sent away from, if it is one of ours. */
function destinationAfterSignIn(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export function LoginPage() {
  usePageTitle('Logowanie');
  const auth = useAuth();
  const demo = useDemoChoice();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailureCode | null>(null);
  const destination = destinationAfterSignIn(location.state);

  if (auth.state.status === 'signed-in' && !demo.isDemo) {
    return <Navigate to={destination} replace />;
  }
  if (auth.state.status === 'loading') {
    return (
      <AuthLayout>
        <Spinner label="Wczytywanie konta…" />
      </AuthLayout>
    );
  }

  const expired = auth.state.status === 'signed-out' && auth.state.notice === 'session-expired';

  return (
    <AuthLayout>
      <PageHeader title="Logowanie" description="Zaloguj się, aby zobaczyć swoje leki i wizyty." />
      <AccountDataNotice />
      {expired && failure === null && (
        <ErrorState title="Sesja wygasła" message={authFailureMessage('session-expired')} />
      )}
      <LoginForm
        isSubmitting={isSubmitting}
        failure={failure}
        onSubmit={(values) => {
          setFailure(null);
          setIsSubmitting(true);
          void auth.signIn(values.email, values.password).then((result) => {
            setIsSubmitting(false);
            if (result.ok) {
              demo.leaveDemo();
              void navigate(destination, { replace: true });
            } else {
              setFailure(result.code);
            }
          });
        }}
      />
      <p className="text-center text-sm">
        Nie masz konta?{' '}
        <Link to="/register" className="font-semibold text-brand-700 underline">
          Załóż konto
        </Link>
      </p>
      <div className="border-t border-line pt-5">
        <p className="mb-3 text-sm text-ink-muted">
          Możesz też obejrzeć wersję demonstracyjną: dane są fikcyjne i zostają tylko w tej
          przeglądarce.
        </p>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            demo.enterDemo();
            void navigate('/', { replace: true });
          }}
        >
          Wypróbuj wersję demonstracyjną
        </Button>
      </div>
    </AuthLayout>
  );
}
