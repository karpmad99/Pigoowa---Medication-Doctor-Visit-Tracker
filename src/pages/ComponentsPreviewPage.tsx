import { useId, useState, type ReactNode, type SubmitEvent } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { usePageTitle } from '@/hooks/usePageTitle';
import { asLocalDate, asTimestamp } from '@/utils/date';
import { formatLocalDate, formatQuantity, formatTimestamp } from '@/utils/format';

// TEMPORARY, development-only page (see routes.tsx): shows every UI primitive in use so they
// can be reviewed in a browser. It is removed from production builds and will be deleted once
// real screens use the components. Everything shown is fictional example text.

function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <Card as="section" aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function ButtonsPreview() {
  const [isLoading, setIsLoading] = useState(false);
  return (
    <PreviewSection title="Przyciski">
      <div className="flex flex-wrap gap-3">
        <Button>Główna akcja</Button>
        <Button variant="secondary">Drugorzędna</Button>
        <Button variant="danger">Usuń</Button>
        <Button variant="ghost">Cicha</Button>
        <Button size="sm">Mały</Button>
        <Button disabled>Wyłączony</Button>
        <Button isLoading={isLoading}>{isLoading ? 'Zapisywanie…' : 'Zapisz'}</Button>
      </div>
      <Button
        variant="secondary"
        onClick={() => {
          setIsLoading((value) => !value);
        }}
      >
        {isLoading ? 'Zakończ ładowanie' : 'Pokaż stan ładowania'}
      </Button>
    </PreviewSection>
  );
}

function FormPreview() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const isValid = name.trim() !== '';
    setError(isValid ? undefined : 'Wpisz nazwę leku.');
    setSubmitted(isValid);
  };

  return (
    <PreviewSection title="Pola formularza">
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="Nazwa leku"
          hint="Przykład: Lek A (fikcyjna nazwa)."
          error={error}
          required
        >
          {(control) => (
            <Input
              {...control}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label="Jednostka dawki">
          {(control) => (
            <Select {...control} defaultValue="tabletka">
              <option value="tabletka">tabletka</option>
              <option value="ml">ml</option>
              <option value="mg">mg</option>
            </Select>
          )}
        </FormField>
        <FormField label="Notatki" hint="Opcjonalnie.">
          {(control) => <Textarea {...control} />}
        </FormField>
        <Button type="submit">Sprawdź formularz</Button>
        {submitted && (
          <p role="status" className="text-sm font-medium text-success-800">
            Formularz jest poprawny. To tylko podgląd: nic nie zostało zapisane.
          </p>
        )}
      </form>
    </PreviewSection>
  );
}

function BadgesPreview() {
  const tones: [BadgeTone, string][] = [
    ['neutral', 'Zaplanowana'],
    ['brand', 'Dzisiaj'],
    ['success', 'Przyjęta'],
    ['warning', 'Do potwierdzenia'],
    ['danger', 'Odwołana'],
    ['info', 'Pominięta'],
  ];
  return (
    <PreviewSection title="Etykiety statusu">
      <div className="flex flex-wrap gap-2">
        {tones.map(([tone, label]) => (
          <Badge key={tone} tone={tone}>
            {label}
          </Badge>
        ))}
      </div>
    </PreviewSection>
  );
}

function StatesPreview() {
  const [retries, setRetries] = useState(0);
  return (
    <PreviewSection title="Stany: ładowanie, pusty, błąd">
      <Spinner />
      <EmptyState
        icon="pill"
        title="Nie dodano jeszcze leków"
        description="Dodaj pierwszy lek, aby zobaczyć jego harmonogram."
        action={<Button variant="secondary">Przykładowa akcja</Button>}
      />
      <ErrorState
        message="Nie udało się wczytać danych. Sprawdź połączenie i spróbuj ponownie."
        onRetry={() => {
          setRetries((count) => count + 1);
        }}
      />
      <p role="status" className="text-sm text-ink-muted">
        Liczba ponownych prób: {retries}
      </p>
    </PreviewSection>
  );
}

function DialogsPreview() {
  const [plainOpen, setPlainOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [result, setResult] = useState('Nic jeszcze nie wybrano.');

  return (
    <PreviewSection title="Okna dialogowe">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            setPlainOpen(true);
          }}
        >
          Otwórz okno
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setConfirmOpen(true);
          }}
        >
          Okno potwierdzenia
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setDangerOpen(true);
          }}
        >
          Okno usuwania
        </Button>
      </div>
      <p role="status" className="text-sm text-ink-muted">
        Wynik: {result}
      </p>

      <Dialog
        open={plainOpen}
        onClose={() => {
          setPlainOpen(false);
          setResult('Zamknięto zwykłe okno.');
        }}
        title="Zwykłe okno"
      >
        <p>Okno można zamknąć klawiszem Escape, przyciskiem lub kliknięciem poza nim.</p>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Potwierdzić akcję?"
        confirmLabel="Potwierdź"
        onConfirm={() => {
          setConfirmOpen(false);
          setResult('Potwierdzono.');
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setResult('Anulowano.');
        }}
      >
        <p>To tylko przykład. Żadne dane nie zostaną zmienione.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dangerOpen}
        tone="danger"
        title="Usunąć przykładowy element?"
        confirmLabel="Usuń na stałe"
        onConfirm={() => {
          setDangerOpen(false);
          setResult('Potwierdzono usunięcie.');
        }}
        onCancel={() => {
          setDangerOpen(false);
          setResult('Anulowano usuwanie.');
        }}
      >
        <p>
          Operacja jest nieodwracalna. W oknach usuwania początkowe skupienie ma przycisk „Anuluj”,
          aby przypadkowy Enter nic nie usunął.
        </p>
      </ConfirmDialog>
    </PreviewSection>
  );
}

function FormattingPreview() {
  return (
    <PreviewSection title="Formatowanie polskie">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-muted">Data</dt>
        <dd>{formatLocalDate(asLocalDate('2026-10-15'))}</dd>
        <dt className="text-ink-muted">Data i godzina (Warszawa)</dt>
        <dd>{formatTimestamp(asTimestamp('2026-10-15T10:30:00Z'), 'Europe/Warsaw')}</dd>
        <dt className="text-ink-muted">Liczba</dt>
        <dd>{formatQuantity(1.5)}</dd>
      </dl>
    </PreviewSection>
  );
}

export function ComponentsPreviewPage() {
  usePageTitle('Podgląd komponentów');
  return (
    <>
      <PageHeader
        title="Podgląd komponentów"
        description="Tymczasowa strona deweloperska. Nie jest dostępna w wersji produkcyjnej."
      />
      <div className="space-y-6 pb-8">
        <ButtonsPreview />
        <FormPreview />
        <BadgesPreview />
        <StatesPreview />
        <DialogsPreview />
        <FormattingPreview />
      </div>
    </>
  );
}
