import { Icon } from '@/components/ui/Icon';

/** Said once at the top of the sign-in and sign-up pages, in every account build, until the privacy review is done (ROADMAP Stage 12). */
export function AccountDataNotice() {
  return (
    <p className="flex gap-2 rounded-card border border-warning-800 bg-warning-50 p-3 text-sm text-warning-800">
      <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
      <span>
        <strong>Wersja rozwojowa.</strong> Dane z konta są zapisywane na serwerze, ale polityka
        prywatności i przegląd bezpieczeństwa nie są jeszcze gotowe. Nie wpisuj prawdziwych danych
        medycznych ani osobowych.
      </span>
    </p>
  );
}
