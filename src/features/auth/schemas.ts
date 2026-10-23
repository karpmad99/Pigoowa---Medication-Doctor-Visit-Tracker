import { z } from 'zod';

// The rules a typed e-mail address and password must pass BEFORE they are sent. The server decides in the end
// (and its refusals are shown too); these only save a round trip for the obvious mistakes. Messages are
// Polish; the password is never trimmed or changed.

const email = z
  .string()
  .trim()
  .min(1, 'Wpisz adres e-mail.')
  .pipe(z.email('Wpisz poprawny adres e-mail, na przykład imie@example.com.'));

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Wpisz hasło.'),
});

/** What the server enforces at least (6) plus a margin; 72 is the length bcrypt can use. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const registerSchema = z
  .object({
    email,
    password: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Hasło musi mieć co najmniej ${String(PASSWORD_MIN_LENGTH)} znaków.`,
      )
      .max(PASSWORD_MAX_LENGTH, `Hasło może mieć najwyżej ${String(PASSWORD_MAX_LENGTH)} znaków.`),
    confirmPassword: z.string().min(1, 'Powtórz hasło.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Hasła nie są takie same.',
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
