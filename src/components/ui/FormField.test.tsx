import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FormField } from './FormField';
import { Input } from './Input';
import { Select } from './Select';
import { Textarea } from './Textarea';

describe('FormField', () => {
  it('connects a visible label to its input', async () => {
    render(<FormField label="Nazwa leku">{(control) => <Input {...control} />}</FormField>);

    const input = screen.getByLabelText('Nazwa leku');
    await userEvent.setup().type(input, 'Lek A');

    expect(input).toHaveValue('Lek A');
    expect(input).toBe(screen.getByRole('textbox', { name: 'Nazwa leku' }));
  });

  it('clicking the label focuses the control', async () => {
    render(<FormField label="Nazwa leku">{(control) => <Input {...control} />}</FormField>);

    await userEvent.setup().click(screen.getByText('Nazwa leku'));

    expect(screen.getByRole('textbox', { name: 'Nazwa leku' })).toHaveFocus();
  });

  it('describes the control with its hint', () => {
    render(
      <FormField label="Dawka" hint="Wpisz liczbę, np. 0,5.">
        {(control) => <Input {...control} />}
      </FormField>,
    );

    expect(screen.getByRole('textbox', { name: 'Dawka' })).toHaveAccessibleDescription(
      'Wpisz liczbę, np. 0,5.',
    );
  });

  it('shows an error, announces it, and marks the control invalid', () => {
    render(
      <FormField label="Nazwa leku" hint="Wymagane." error="Wpisz nazwę leku.">
        {(control) => <Input {...control} />}
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Nazwa leku' });
    expect(screen.getByRole('alert')).toHaveTextContent('Wpisz nazwę leku.');
    expect(input).toBeInvalid();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Wymagane. Wpisz nazwę leku.');
  });

  it('is valid, with no error region and no description, when there is nothing to report', () => {
    render(<FormField label="Nazwa leku">{(control) => <Input {...control} />}</FormField>);

    const input = screen.getByRole('textbox', { name: 'Nazwa leku' });
    expect(input).toBeValid();
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks required fields for assistive technology without adding the asterisk to the name', () => {
    render(
      <FormField label="Nazwa leku" required>
        {(control) => <Input {...control} />}
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: 'Nazwa leku' });
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toBeRequired();
  });

  it('gives every field its own id, so labels never point at the wrong control', () => {
    render(
      <>
        <FormField label="Pierwsze">{(control) => <Input {...control} />}</FormField>
        <FormField label="Drugie">{(control) => <Input {...control} />}</FormField>
      </>,
    );

    const first = screen.getByRole('textbox', { name: 'Pierwsze' });
    const second = screen.getByRole('textbox', { name: 'Drugie' });
    expect(first.id).not.toBe(second.id);
  });

  it('works the same way for selects and textareas', async () => {
    render(
      <>
        <FormField label="Jednostka">
          {(control) => (
            <Select {...control}>
              <option value="ml">ml</option>
              <option value="mg">mg</option>
            </Select>
          )}
        </FormField>
        <FormField label="Notatki" error="Za długie.">
          {(control) => <Textarea {...control} />}
        </FormField>
      </>,
    );

    const select = screen.getByRole('combobox', { name: 'Jednostka' });
    await userEvent.setup().selectOptions(select, 'mg');
    expect(select).toHaveValue('mg');
    expect(screen.getByRole('textbox', { name: 'Notatki' })).toBeInvalid();
  });
});
