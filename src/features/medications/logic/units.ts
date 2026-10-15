/** Canonical form used only for comparing units: trimmed, single-spaced, lower case. */
export function normalizeUnit(unit: string): string {
  return unit.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');
}

/**
 * True when two unit strings name the same unit ("Tabletka " equals "tabletka").
 * Different units ("mg" vs "ml", "tabletka" vs "kapsułka") are never equal and are never
 * converted: if units differ, calculations must be refused instead of guessed.
 */
export function unitsMatch(a: string, b: string): boolean {
  const normalized = normalizeUnit(a);
  return normalized !== '' && normalized === normalizeUnit(b);
}
