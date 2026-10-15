import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Nie znaleziono strony</h1>
      <p className="mt-2 text-slate-600">Adres, który wpisano, nie istnieje w aplikacji.</p>
      <Link
        to="/"
        className="mt-4 inline-block text-teal-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
      >
        Wróć do pulpitu
      </Link>
    </section>
  );
}
