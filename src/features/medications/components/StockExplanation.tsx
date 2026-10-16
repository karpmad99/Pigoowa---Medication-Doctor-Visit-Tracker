/**
 * Says in plain words what the stock figure is and is not. Shown wherever stock is shown, so the
 * estimate is never mistaken for an exact count. It states the one rule that can surprise: what
 * counts is when a dose was RECORDED in the app (PROJECT_SPEC §7.3), not its time in the schedule.
 */
export function StockExplanation() {
  return (
    <details className="rounded-card border border-line bg-surface p-4 text-sm">
      <summary className="cursor-pointer rounded-control font-semibold text-ink">
        Jak liczymy szacunkowy zapas?
      </summary>
      <div className="mt-3 space-y-2 text-ink-muted">
        <p>
          To szacunek, a nie dokładny stan. Zaczynamy od ilości wpisanej w edycji leku i odejmujemy
          dawki <strong>przyjęte</strong>, które zapisano po wpisaniu zapasu.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Dawki pominięte nie zmniejszają zapasu.</li>
          <li>Dawki zaplanowane, ale niezapisane, też go nie zmniejszają.</li>
          <li>Jeśli zapomnisz zapisać przyjętą dawkę, szacunek będzie zbyt optymistyczny.</li>
          <li>
            Liczy się moment zapisania dawki w aplikacji, a nie jej godzina w harmonogramie. Dawka
            zapisana po wpisaniu zapasu zmniejsza go, nawet jeśli dotyczy wcześniejszej godziny.
            Zmiana statusu zapisanej dawki liczy się jak nowy zapis.
          </li>
          <li>
            Jeśli wpisany zapas już uwzględnia daną dawkę, wpisz aktualną ilość ponownie w edycji
            leku: liczenie zacznie się od nowa.
          </li>
          <li>
            Jednostek nie przeliczamy. Gdy jednostka zapasu różni się od jednostki dawki, szacunek
            jest niedostępny i podajemy powód.
          </li>
          <li>Bez wpisanego zapasu nie pokazujemy żadnej liczby, a nie „0”.</li>
        </ul>
      </div>
    </details>
  );
}
