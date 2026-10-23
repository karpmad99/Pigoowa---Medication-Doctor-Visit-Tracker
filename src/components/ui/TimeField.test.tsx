import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeField } from './TimeField';

// A parent that holds the value, as a form does.
function Harness({
  initial = '',
  onValue,
  formError = false,
  quickTimes,
  disabled = false,
}: {
  initial?: string;
  onValue?: (value: string) => void;
  formError?: boolean;
  quickTimes?: readonly string[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <label htmlFor="time">Godzina 1</label>
      <TimeField
        id="time"
        aria-invalid={formError ? true : undefined}
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        pickerLabel="Wybierz z zegara godzinę 1"
        quickPicksLabel="Popularne godziny dla pozycji 1"
        quickTimes={quickTimes}
        disabled={disabled}
      />
      <output data-testid="held">{value}</output>
      <button type="button">Dalej</button>
    </div>
  );
}

const box = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Godzina 1' });
const held = () => screen.getByTestId('held').textContent;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TimeField: typing', () => {
  it("is a text field with a number keypad, not the phone's own time control", () => {
    render(<Harness />);

    expect(box()).toHaveAttribute('type', 'text');
    expect(box()).toHaveAttribute('inputmode', 'numeric');
    expect(box()).toHaveAttribute('autocomplete', 'off');
  });

  it.each([
    ['0730', '07:30'],
    ['730', '07:30'],
    ['7:30', '07:30'],
    ['7.30', '07:30'],
    ['07:30', '07:30'],
    ['2359', '23:59'],
  ])('typing %j gives the form %s', async (typed, expected) => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), typed);

    expect(held()).toBe(expected);
  });

  it('shows what was typed while typing and only then normalises it, when the field is left', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), '730');
    expect(box()).toHaveValue('730');
    expect(held()).toBe('07:30');

    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(box()).toHaveValue('07:30');
  });

  it('gives the form the text as typed while it is not yet a time, and never erases it', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(<Harness onValue={(value) => seen.push(value)} />);

    await user.type(box(), '0730');

    expect(seen).toEqual(['0', '07', '073', '07:30']);
    expect(box()).toHaveValue('0730');
  });

  it('shows no message while typing, even for half a time', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), '07:');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(box()).not.toBeInvalid();
  });

  it('keeps an unfinished entry when the field is left, and says what to type', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), '07:3');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(box()).toHaveValue('07:3');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Wpisz godzinę w formacie GG:MM, na przykład 07:30.',
    );
    expect(box()).toBeInvalid();
    expect(box()).toHaveAccessibleDescription('Wpisz godzinę w formacie GG:MM, na przykład 07:30.');
  });

  it('says when no such time exists, and keeps the entry', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), '2575');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(box()).toHaveValue('2575');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Taka godzina nie istnieje. Wpisz godzinę od 00:00 do 23:59.',
    );
  });

  it('keeps text that is not a time (letters) and says what to type', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), 'abc');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(box()).toHaveValue('abc');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('lets the person correct the entry; the message goes away as soon as it is a time', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '2575');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.clear(box());
    await user.type(box(), '0745');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(box()).not.toBeInvalid();
    expect(held()).toBe('07:45');
  });

  it('says nothing about an empty field that is left (the form says it is required)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(box());
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not repeat the message when the form already shows an error for the field', async () => {
    const user = userEvent.setup();
    render(<Harness formError />);

    await user.type(box(), '07:3');
    await user.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(box()).toBeInvalid();
  });

  it('follows a change that comes from outside (the form was reset)', () => {
    const { rerender } = render(<Harness initial="08:00" />);
    expect(box()).toHaveValue('08:00');

    rerender(<Harness initial="08:00" />);
    expect(box()).toHaveValue('08:00');
  });

  it('starts from a stored time and shows it as HH:mm', () => {
    render(<Harness initial="20:00" />);

    expect(box()).toHaveValue('20:00');
    expect(screen.getByRole('button', { name: 'Ustaw 20:00' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('TimeField: quick picks', () => {
  it('offers the usual times as buttons that say what they set', () => {
    render(<Harness />);

    const group = screen.getByRole('group', { name: 'Popularne godziny dla pozycji 1' });
    expect(
      Array.from(group.querySelectorAll('button')).map((button) => button.textContent),
    ).toEqual(['06:00', '08:00', '12:00', '18:00', '20:00', '22:00']);
    expect(screen.getByRole('button', { name: 'Ustaw 08:00' })).toBeInTheDocument();
  });

  it('sets the time when pressed, shows it in the box and marks the pressed one', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Ustaw 18:00' }));

    expect(box()).toHaveValue('18:00');
    expect(held()).toBe('18:00');
    expect(screen.getByRole('button', { name: 'Ustaw 18:00' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Ustaw 08:00' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('stops marking a quick pick when another time is typed', async () => {
    const user = userEvent.setup();
    render(<Harness initial="08:00" />);

    await user.clear(box());
    await user.type(box(), '0915');

    expect(screen.getByRole('button', { name: 'Ustaw 08:00' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('can offer other times (an appointment form does)', () => {
    render(<Harness quickTimes={['09:00', '14:00']} />);

    expect(screen.getByRole('button', { name: 'Ustaw 09:00' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ustaw 06:00' })).not.toBeInTheDocument();
  });

  it('is one stop in the Tab order, and the arrow keys move between the buttons', async () => {
    const user = userEvent.setup();
    render(<Harness initial="12:00" />);
    const buttons = screen.getAllByRole('button', { name: /^Ustaw / });
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ustaw 12:00' }).tabIndex).toBe(0);

    screen.getByRole('button', { name: 'Ustaw 12:00' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Ustaw 18:00' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'Ustaw 22:00' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Ustaw 22:00' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'Ustaw 06:00' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Ustaw 06:00' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(held()).toBe('06:00');
  });

  it('makes every button at least 44 px tall (the class that sets it)', () => {
    render(<Harness />);

    for (const button of screen.getAllByRole('button', { name: /^Ustaw / })) {
      expect(button.className).toContain('min-h-11');
    }
    expect(box().className).toContain('min-h-11');
  });
});

describe('TimeField: the system clock picker', () => {
  it('is offered as a transparent native time input over a visible "Zegar" button, with a name that says which time', () => {
    render(<Harness initial="08:30" />);

    const picker = screen.getByLabelText('Wybierz z zegara godzinę 1');
    expect(picker).toHaveAttribute('type', 'time');
    expect(picker).toHaveValue('08:30');
    expect(picker.className).toContain('opacity-0');
    expect(screen.getByText('Zegar')).toBeInTheDocument();
  });

  it('starts empty when the text is not yet a time', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box(), '07:');

    expect(screen.getByLabelText('Wybierz z zegara godzinę 1')).toHaveValue('');
  });

  it('sets the time from the picker, in the box and in the form', () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('Wybierz z zegara godzinę 1'), {
      target: { value: '09:15' },
    });

    expect(box()).toHaveValue('09:15');
    expect(held()).toBe('09:15');
  });

  it('opens the browser picker when pressed, and does nothing worse where it cannot', () => {
    const showPicker = vi.fn();
    HTMLInputElement.prototype.showPicker = showPicker;
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Wybierz z zegara godzinę 1'));
    expect(showPicker).toHaveBeenCalledTimes(1);

    HTMLInputElement.prototype.showPicker = () => {
      throw new DOMException('not allowed', 'NotAllowedError');
    };
    expect(() => {
      fireEvent.click(screen.getByLabelText('Wybierz z zegara godzinę 1'));
    }).not.toThrow();
  });

  it('is left out where the browser has no time control of its own', () => {
    // A browser that ignores type="time" keeps "text" when the probe asks for it.
    vi.spyOn(HTMLInputElement.prototype, 'type', 'set').mockImplementation(() => undefined);

    render(<Harness />);

    expect(screen.queryByText('Zegar')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Wybierz z zegara godzinę 1')).not.toBeInTheDocument();
    // Typing and the quick picks still work.
    expect(box()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ustaw 08:00' })).toBeInTheDocument();
  });
});

describe('TimeField: when disabled', () => {
  it('disables the box, the clock and every quick pick', () => {
    render(<Harness disabled />);

    expect(box()).toBeDisabled();
    expect(screen.getByLabelText('Wybierz z zegara godzinę 1')).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: /^Ustaw / })) {
      expect(button).toBeDisabled();
    }
  });
});
