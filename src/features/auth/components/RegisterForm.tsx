import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { authFailureMessage } from '../authErrors';
import { PASSWORD_MIN_LENGTH, registerSchema, type RegisterValues } from '../schemas';
import type { AuthFailureCode } from '../types';

interface RegisterFormProps {
  isSubmitting: boolean;
  failure: AuthFailureCode | null;
  onSubmit: (values: RegisterValues) => void;
}

export function RegisterForm({ isSubmitting, failure, onSubmit }: RegisterFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
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
      <FormField
        label="Hasło"
        hint={`Co najmniej ${String(PASSWORD_MIN_LENGTH)} znaków.`}
        error={errors.password?.message}
        required
      >
        {(field) => (
          <Input {...field} type="password" autoComplete="new-password" {...register('password')} />
        )}
      </FormField>
      <FormField label="Powtórz hasło" error={errors.confirmPassword?.message} required>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="new-password"
            {...register('confirmPassword')}
          />
        )}
      </FormField>
      {failure !== null && (
        <ErrorState title="Nie udało się założyć konta" message={authFailureMessage(failure)} />
      )}
      <Button type="submit" isLoading={isSubmitting} className="w-full">
        Załóż konto
      </Button>
    </form>
  );
}
