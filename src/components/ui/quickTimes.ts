// The times a time field offers as quick-pick buttons (see TimeField). They are only shortcuts:
// any time can still be typed.

/** Usual times to take a medicine. */
export const MEDICATION_QUICK_TIMES = [
  '06:00',
  '08:00',
  '12:00',
  '18:00',
  '20:00',
  '22:00',
] as const;

/** Usual times of a doctor's appointment. */
export const APPOINTMENT_QUICK_TIMES = [
  '08:00',
  '09:00',
  '10:00',
  '12:00',
  '14:00',
  '16:00',
] as const;
