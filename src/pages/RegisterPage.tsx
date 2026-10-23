import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useDemoChoice } from '@/app/accountAppContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { AccountDataNotice } from '@/features/auth/components/AuthNotice';
import { RegisterForm } from '@/features/auth/components/RegisterForm';
import type { AuthFailureCode } from '@/features/auth/types';
import { useAuth } from '@/features/auth/useAuth';
import { usePageTitle } from '@/hooks/usePageTitle';

export function RegisterPage() {
  usePageTitle('Rejestracja');
  const auth = useAuth();
  const demo = useDemoChoice();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<AuthFailureCode | null>(null);
  const [confirmationNeeded, setConfirmationNeeded] = useState(false);

  if (auth.state.status === 'signed-in' && !demo.isDemo) return <Navigate to="/" replace />;
  if (auth.state.status === 'loading') {
    return (
      <AuthLayout>
        <Spinner label="Wczytywanie konta…" />
      </AuthLayout>
    );
  }

  if (confirmationNeeded) {
    return (
      <AuthLayout>
        <PageHeader title="Sprawdź skrzynkę" />
        <p role="status" className="flex gap-2 rounded-card border border-line bg-surface p-4">
          <Icon name="info" className="mt-0.5 size-4 shrink-0" />
          <span>
            Konto zostało założone. Wysłaliśmy wiadomość z linkiem potwierdzającym adres e-mail. Po
            kliknięciu w link możesz się zalogować.
          </span>
        </p>
        <ButtonLink to="/login" className="w-full">
          Przejdź do logowania
        </ButtonLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <PageHeader
        title="Załóż konto"
        description="Konto pozwala zapisać leki i wizyty na serwerze."
      />
      <AccountDataNotice />
      <RegisterForm
        isSubmitting={isSubmitting}
        failure={failure}
        onSubmit={(values) => {
          setFailure(null);
          setIsSubmitting(true);
          void auth.signUp(values.email, values.password).then((result) => {
            setIsSubmitting(false);
            if (!result.ok) {
              setFailure(result.code);
            } else if (result.value.confirmationNeeded) {
              setConfirmationNeeded(true);
            } else {
              demo.leaveDemo();
              void navigate('/', { replace: true });
            }
          });
        }}
      />
      <p className="text-center text-sm">
        Masz już konto?{' '}
        <Link to="/login" className="font-semibold text-brand-700 underline">
          Zaloguj się
        </Link>
      </p>
    </AuthLayout>
  );
}
