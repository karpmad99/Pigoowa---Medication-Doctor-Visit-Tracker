import { formatQuantity } from '@/utils/format';
import { normalizeUnit } from './units';

// Polish nouns change with the number: 1 tabletka, 2 tabletki, 5 tabletek, 1,5 tabletki. The unit
// is free text typed by the user, so the app cannot inflect arbitrary words. It knows the common
// ones below and shows anything else exactly as typed, after the number. Units that never change
// (ml, mg, ...) are listed with the same form everywhere. Nothing here converts between units.

interface UnitForms {
  one: string;
  few: string;
  many: string;
  /** For fractions ("1,5 tabletki"): the genitive singular. */
  fraction: string;
}

function invariant(unit: string): UnitForms {
  return { one: unit, few: unit, many: unit, fraction: unit };
}

const knownUnits: ReadonlyMap<string, UnitForms> = new Map(
  Object.entries({
    tabletka: { one: 'tabletka', few: 'tabletki', many: 'tabletek', fraction: 'tabletki' },
    kapsułka: { one: 'kapsułka', few: 'kapsułki', many: 'kapsułek', fraction: 'kapsułki' },
    ampułka: { one: 'ampułka', few: 'ampułki', many: 'ampułek', fraction: 'ampułki' },
    saszetka: { one: 'saszetka', few: 'saszetki', many: 'saszetek', fraction: 'saszetki' },
    dawka: { one: 'dawka', few: 'dawki', many: 'dawek', fraction: 'dawki' },
    kropla: { one: 'kropla', few: 'krople', many: 'kropli', fraction: 'kropli' },
    plaster: { one: 'plaster', few: 'plastry', many: 'plastrów', fraction: 'plastra' },
    czopek: { one: 'czopek', few: 'czopki', many: 'czopków', fraction: 'czopka' },
    wstrzyknięcie: {
      one: 'wstrzyknięcie',
      few: 'wstrzyknięcia',
      many: 'wstrzyknięć',
      fraction: 'wstrzyknięcia',
    },
    ml: invariant('ml'),
    mg: invariant('mg'),
    g: invariant('g'),
    mcg: invariant('mcg'),
    µg: invariant('µg'),
    'j.m.': invariant('j.m.'),
    iu: invariant('IU'),
  }),
);

const pluralRules = new Intl.PluralRules('pl-PL');

/**
 * A quantity with its unit as Polish reads it: `1 tabletka`, `2 tabletki`, `5 tabletek`,
 * `1,5 tabletki`, `5 ml`. An unrecognised unit is shown as typed (`2 inhalacja`): correct
 * grammar for arbitrary words is out of reach, and changing the user's text would be worse.
 */
export function formatAmount(quantity: number, unit: string): string {
  const number = formatQuantity(quantity);
  const forms = knownUnits.get(normalizeUnit(unit));
  if (forms === undefined) return `${number} ${unit.trim()}`;
  if (!Number.isInteger(quantity)) return `${number} ${forms.fraction}`;
  const category = pluralRules.select(quantity);
  const word = category === 'one' ? forms.one : category === 'few' ? forms.few : forms.many;
  return `${number} ${word}`;
}
