import { Icon } from '@/components/ui/Icon';

/**
 * The permanent notice of the demonstration version (ROADMAP stage 9): the data is fictional, it
 * is kept in this browser only, and it is not encrypted. It is shown on every page and cannot be
 * dismissed, so nobody who lands on a deep link can miss it. It belongs to the demo build: it goes
 * away when real, protected persistence arrives (stages 10 and 11).
 */
// A named <section> is a landmark ("region"), so the notice is not content outside every landmark.
export function DemoBanner() {
  return (
    <section
      aria-label="Informacja o wersji demonstracyjnej"
      className="border-b border-warning-800 bg-warning-50 px-4 py-3 text-sm text-warning-800 sm:px-6 md:px-8"
    >
      <p className="mx-auto flex max-w-4xl gap-2">
        <Icon name="alert" className="mt-0.5 size-4" />
        <span>
          <strong>Wersja demonstracyjna: dane fikcyjne.</strong> Dane zapisują się tylko w tej
          przeglądarce (localStorage) i nie są szyfrowane. Nie wpisuj prawdziwych danych medycznych
          ani osobowych.
        </span>
      </p>
    </section>
  );
}
