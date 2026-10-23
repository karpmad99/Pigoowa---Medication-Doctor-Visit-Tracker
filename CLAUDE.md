# Pigoowa - Zasady pracy z Claude Code

## Filozofia pracy
- **Samodzielność**: Główny Claude realizuje zadania samodzielnie. Unikaj subagentów przy małych zadaniach.
- **Oszczędność**: Nie czytaj całego repozytorium bez potrzeby. Sprawdzaj tylko pliki istotne dla zadania.
- **Jakość**: Nie osłabiaj testów ani zabezpieczeń (RLS, typowanie) dla szybszych wyników.
- **Bezpieczeństwo**: Nie wykonuj operacji destrukcyjnych (`rm`, `git reset`, `git push`) bez wyraźnej zgody.

## Delegowanie zadań (subagenci)
- Używaj maksymalnie jednego subagenta `code-reviewer` przy większych/ryzykownych zmianach.
- `code-reviewer` ma tylko uprawnienia do odczytu (read-only).
- Nie uruchamiaj subagentów automatycznie przy drobnych poprawkach.

## Procedura pracy
1. Analiza: Sprawdź `git status`, potrzebne pliki i kontekst zadania.
2. Implementacja: Wykonuj zadania, naprawiaj testy, uruchamiaj testy celowane.
3. Weryfikacja: Po zakończeniu zmian uruchom pełny zestaw testów (`npm test`).
4. Raport: Zwróć końcowy raport z wykonanych zmian i potwierdzenie sukcesu testów.
