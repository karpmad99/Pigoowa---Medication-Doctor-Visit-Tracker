import { useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { cx } from '@/utils/cx';
import { describeTimeInput, parseTimeInput } from '@/utils/timeInput';
import type { FormControlProps } from './FormField';
import { Icon } from './Icon';
import { Input } from './Input';
import { MEDICATION_QUICK_TIMES } from './quickTimes';

const FORMAT_MESSAGE = 'Wpisz godzinę w formacie GG:MM, na przykład 07:30.';
const RANGE_MESSAGE = 'Taka godzina nie istnieje. Wpisz godzinę od 00:00 do 23:59.';

interface TimeFieldProps extends FormControlProps {
  name?: string;
  /** What the form holds: the normalised `HH:mm` once the entry is a time, otherwise what was typed. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  /** Names the clock button so that it says which time it is for (several fields can be on one page). */
  pickerLabel: string;
  /** Names the group of quick-pick buttons the same way. */
  quickPicksLabel: string;
  quickTimes?: readonly string[];
  disabled?: boolean;
}

/** Whether this browser draws its own time picker (otherwise `type="time"` falls back to plain text). */
function supportsNativeTime(): boolean {
  const probe = document.createElement('input');
  probe.type = 'time';
  return probe.type === 'time';
}

function openNativePicker(input: HTMLInputElement): void {
  try {
    input.showPicker();
  } catch {
    // Not supported, or not allowed right now. The transparent input still opens the picker when
    // tapped on the platforms that do that on their own (the phones this exists for).
  }
}

/**
 * A time of day that can be TYPED (PROJECT_SPEC DEC-49). A phone's own time control forces its
 * picker; this is a text field with a number keypad, plus large quick-pick buttons and, as an
 * option, the system clock picker.
 *
 * - `7:30`, `0730`, `730`, `07:30` and `7.30` all mean 07:30. While the person is typing nothing
 *   is changed or erased and no message is shown: a half-typed time is not an error yet.
 * - As soon as the text is a complete, existing time, the form receives the normalised `HH:mm`,
 *   so the form's rules, the duplicate check and the stored value never see another shape.
 * - When the person leaves the field, a valid entry is shown as `HH:mm`; anything else stays as
 *   typed (never cleared) and a message says what to type.
 * - The clock picker is a transparent native `<input type="time">` laid over a visible button, so
 *   a tap reaches the platform's own control; it is left out where the browser has none.
 */
export function TimeField({
  name,
  value,
  onChange,
  onBlur,
  inputRef,
  pickerLabel,
  quickPicksLabel,
  quickTimes = MEDICATION_QUICK_TIMES,
  disabled = false,
  id,
  ...aria
}: TimeFieldProps) {
  // What is shown in the box. It differs from `value` while typing ("7:30" is shown, "07:30" is held).
  const [text, setText] = useState(value);
  // The last value this component gave to the form, to tell a change it caused from one that came
  // from outside (the form was reset), which the box must follow.
  const [given, setGiven] = useState(value);
  if (value !== given) {
    setGiven(value);
    setText(value);
  }
  const [left, setLeft] = useState(false);
  const [nativePicker] = useState(supportsNativeTime);

  const give = (next: string) => {
    setGiven(next);
    onChange(next);
  };

  const typed = describeTimeInput(text);
  const time = typed.kind === 'valid' ? typed.time : null;
  const formHasError = aria['aria-invalid'] === true;
  const localMessage =
    left && !formHasError && (typed.kind === 'incomplete' || typed.kind === 'unrecognised')
      ? FORMAT_MESSAGE
      : left && !formHasError && typed.kind === 'out-of-range'
        ? RANGE_MESSAGE
        : null;
  const messageId = `${id}-time-message`;
  const describedBy = [aria['aria-describedby'], localMessage === null ? null : messageId]
    .filter(Boolean)
    .join(' ');

  const choose = (next: string) => {
    setText(next);
    give(next);
  };

  // The quick picks are ONE stop in the Tab order (the selected one, or the first), and the arrow
  // keys move between them: a person who types does not have to Tab past six buttons.
  const quickButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedQuick = time === null ? -1 : quickTimes.indexOf(time);
  const quickTabStop = selectedQuick >= 0 ? selectedQuick : 0;
  const moveAmongQuickPicks = (event: KeyboardEvent, from: number) => {
    const last = quickTimes.length - 1;
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? Math.min(from + 1, last)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? Math.max(from - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    quickButtons.current[target]?.focus();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        <Input
          {...aria}
          id={id}
          name={name}
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="np. 07:30"
          disabled={disabled}
          aria-invalid={aria['aria-invalid'] === true || localMessage !== null ? true : undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          className="min-w-0 flex-1 tabular-nums"
          value={text}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            // The form gets the normalised time as soon as there is one, the raw text before that.
            give(parseTimeInput(next) ?? next);
          }}
          onBlur={() => {
            setLeft(true);
            if (time !== null) setText(time);
            onBlur?.();
          }}
        />
        {nativePicker && (
          <span
            className={cx(
              'relative inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control border border-line-strong bg-surface px-3',
              'text-base font-semibold text-ink hover:bg-canvas has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-700',
              disabled && 'opacity-70',
            )}
          >
            <Icon name="clock" />
            <span aria-hidden="true">Zegar</span>
            <input
              type="time"
              aria-label={pickerLabel}
              disabled={disabled}
              value={time ?? ''}
              className="absolute -inset-px h-[calc(100%+2px)] w-[calc(100%+2px)] cursor-pointer opacity-0"
              onClick={(event) => {
                openNativePicker(event.currentTarget);
              }}
              onChange={(event) => {
                const picked = parseTimeInput(event.target.value);
                if (picked !== null) choose(picked);
              }}
            />
          </span>
        )}
      </div>

      <div role="group" aria-label={quickPicksLabel} className="flex flex-wrap gap-2">
        {quickTimes.map((quick, index) => (
          <button
            key={quick}
            ref={(node) => {
              quickButtons.current[index] = node;
            }}
            type="button"
            tabIndex={index === quickTabStop ? 0 : -1}
            disabled={disabled}
            aria-pressed={time === quick}
            aria-label={`Ustaw ${quick}`}
            className={cx(
              'inline-flex min-h-11 min-w-18 items-center justify-center rounded-control border px-3 text-base font-semibold tabular-nums transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-60',
              time === quick
                ? 'border-brand-700 bg-brand-50 text-brand-700'
                : 'border-line-strong bg-surface text-ink hover:bg-canvas',
            )}
            onClick={() => {
              choose(quick);
            }}
            onKeyDown={(event) => {
              moveAmongQuickPicks(event, index);
            }}
          >
            {quick}
          </button>
        ))}
      </div>

      {localMessage !== null && (
        <p id={messageId} role="alert" className="text-sm font-medium text-danger-700">
          {localMessage}
        </p>
      )}
    </div>
  );
}
