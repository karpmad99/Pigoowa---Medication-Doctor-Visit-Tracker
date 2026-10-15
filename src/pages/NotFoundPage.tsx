import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { usePageTitle } from '@/hooks/usePageTitle';

export function NotFoundPage() {
  usePageTitle('Nie znaleziono strony');
  return (
    <>
      <PageHeader
        title="Nie znaleziono strony"
        description="Adres, który wpisano, nie istnieje w aplikacji. Mógł zostać zmieniony albo zawiera literówkę."
      />
      <ButtonLink to="/">Wróć do pulpitu</ButtonLink>
    </>
  );
}
