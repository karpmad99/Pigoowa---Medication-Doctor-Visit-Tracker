import { z } from 'zod';
import { MEDICATION_LIMITS } from './logic/limits';
import {
  validateMedicationForm,
  type MedicationFormIssueCode,
  type MedicationFormValues,
} from './logic/medicationForm';

/** The Polish message for each kind of problem found in the medication form. */
export const medicationFormMessages: Record<MedicationFormIssueCode, string> = {
  'name-required': 'Wpisz nazwę leku.',
  'name-too-long': `Nazwa może mieć najwyżej ${String(MEDICATION_LIMITS.name)} znaków.`,
  'unit-required': 'Wybierz lub wpisz jednostkę dawki, na przykład tabletka lub ml.',
  'unit-too-long': `Jednostka może mieć najwyżej ${String(MEDICATION_LIMITS.doseUnit)} znaków.`,
  'dosage-form-invalid': 'Wybierz postać leku z listy albo zostaw „Nie wybrano”.',
  'strength-value-invalid':
    'Wpisz moc jako liczbę większą od zera (do 3 miejsc po przecinku) albo zostaw pole puste.',
  'strength-value-required': 'Wpisz liczbę mocy albo usuń jej jednostkę.',
  'strength-unit-required': 'Wybierz jednostkę mocy, na przykład mg.',
  'strength-unit-invalid': 'Wybierz jednostkę mocy z listy.',
  'stock-unit-too-long': `Jednostka zapasu może mieć najwyżej ${String(MEDICATION_LIMITS.doseUnit)} znaków.`,
  'threshold-invalid':
    'Wpisz próg jako liczbę równą lub większą od zera (do 3 miejsc po przecinku) albo zostaw pole puste.',
  'threshold-needs-stock': 'Próg dotyczy zapasu. Wpisz najpierw aktualny zapas albo usuń próg.',
  'notes-too-long': `Notatki mogą mieć najwyżej ${String(MEDICATION_LIMITS.notes)} znaków.`,
  'start-invalid': 'Wybierz poprawną datę rozpoczęcia.',
  'end-invalid': 'Wybierz poprawną datę zakończenia albo zostaw pole puste.',
  'end-before-start': 'Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.',
  'schedule-empty': 'Dodaj co najmniej jedną godzinę przyjmowania.',
  'time-invalid': 'Wpisz godzinę w formacie GG:MM, na przykład 07:30.',
  'time-duplicate': 'Ta godzina jest już na liście. Każda godzina może wystąpić tylko raz.',
  'amount-invalid':
    'Wpisz dawkę większą od zera, na przykład 1 lub 0,5 (do 3 miejsc po przecinku).',
  'stock-invalid':
    'Wpisz zapas jako liczbę równą lub większą od zera (do 3 miejsc po przecinku) albo zostaw pole puste.',
};

/** "scheduleTimes.1.timeOfDay" -> ["scheduleTimes", 1, "timeOfDay"], the form Zod paths use. */
function toZodPath(path: string): (string | number)[] {
  return path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/**
 * Zod's view of the medication form. It only checks the SHAPE (everything is text, as typed) and
 * then hands the values to `validateMedicationForm`, which holds the actual rules and reuses
 * the Stage 2 ones, attaching the Polish message to each problem. The rules live in one place;
 * this schema is the thin adapter React Hook Form needs.
 */
export const medicationFormSchema: z.ZodType<MedicationFormValues, MedicationFormValues> = z
  .object({
    name: z.string(),
    dosageForm: z.string(),
    doseUnit: z.string(),
    strengthValue: z.string(),
    strengthUnit: z.string(),
    notes: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    scheduleTimes: z.array(
      z.object({ scheduleTimeId: z.string(), timeOfDay: z.string(), doseAmount: z.string() }),
    ),
    stockQuantity: z.string(),
    stockUnit: z.string(),
    lowStockThreshold: z.string(),
    lowStockThresholdUnit: z.string(),
  })
  .superRefine((values, context) => {
    for (const issue of validateMedicationForm(values)) {
      context.addIssue({
        code: 'custom',
        path: toZodPath(issue.path),
        message: medicationFormMessages[issue.code],
      });
    }
  });
