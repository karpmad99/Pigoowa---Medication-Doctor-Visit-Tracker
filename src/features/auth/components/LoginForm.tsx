import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { authFailureMessage } from '../authErrors';
import { loginSchema, type LoginValues } from '../schemas';
import type { AuthFailureCode } from '../types';

interface LoginFormProps {
  isSubmitting: boolean;
  /** Why the last attempt failed. The typed e-mail stays in the form; the password is kept too, so a network failure can be retried at once. */
  failure: AuthFailureCode | null;
  onSubmit: (values: LoginValues) => void;
}

export function LoginForm({ isSubmitting, failure, onSubmit }: LoginFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
      className="space-y-5"
    >
      <FormField label="Adres e-mail" error={errors.email?.message} required>
        {(field) => <Input {...field} type="email" autoComplete="email" {...register('email')} />}
      </FormField>
      <FormField label="Hasło" error={errors.password?.message} required>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        )}
      </FormField>
      {failure !== null && (
        <ErrorState title="Nie udało się zalogować" message={authFailureMessage(failure)} />
      )}
      <Button type="submit" isLoading={isSubmitting} className="w-full">
        Zaloguj się
      </Button>
    </form>
  );
}
