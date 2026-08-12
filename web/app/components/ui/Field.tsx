import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

/** Exactly what React hands an <input onInput>, so forwarding it typechecks. */
type InputHandler = NonNullable<InputHTMLAttributes<HTMLInputElement>['onInput']>;
import { useTranslation } from 'react-i18next';
import { cn } from '~/lib/cn';

/**
 * Input formats that reject bad characters as they are typed.
 *
 * The alternative — accept anything, then reject it server-side — means the
 * user fills in a whole form before learning the second field was wrong. Better
 * that the character simply never appears.
 */
type Format = 'upperAlpha';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  /** Field-level message from the API or client validation. */
  error?: string;
  action?: ReactNode;
  format?: Format;
}

/**
 * Label, control, hint and error in one component.
 *
 * Every form field in the product uses it, which is what makes spacing and
 * error placement identical everywhere — and makes the accessibility wiring
 * (`aria-describedby`, `aria-invalid`) impossible to forget on a new field.
 *
 * Password fields get a show/hide toggle automatically. Putting it here rather
 * than in each form means there is no way to add a password input that lacks
 * one, which is how the first six ended up without it.
 */
export function Field({
  label,
  hint,
  error,
  action,
  className,
  type,
  format,
  onInput,
  ...props
}: FieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const [revealed, setRevealed] = useState(false);

  /**
   * Sanitises as the user types.
   *
   * The cursor has to be restored by hand: rewriting `value` moves the caret to
   * the end, so editing the middle of an existing entry would jump every
   * keystroke. Rejected characters shift it back by one, which is why the
   * offset is computed from the length difference rather than assumed.
   */
  const handleInput: InputHandler = (event) => {
    if (format === 'upperAlpha') {
      const input = event.currentTarget;
      const before = input.value;
      const after = before.toUpperCase().replace(/[^A-Z]/g, '');

      if (after !== before) {
        const caret = input.selectionStart ?? after.length;
        input.value = after;
        const shift = before.length - after.length;
        input.setSelectionRange(caret - shift, caret - shift);
      }
    }

    onInput?.(event);
  };

  const isPassword = type === 'password';
  // Swapping to `text` is what actually reveals it; the prop stays 'password'
  // so the browser still offers to save and autofill it.
  const inputType = isPassword && revealed ? 'text' : type;

  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-content-primary">
          {label}
          {props.required && (
            <span aria-hidden className="ms-1 text-danger-500">
              *
            </span>
          )}
        </label>
        {action}
      </div>

      <div className="relative">
        <input
          id={id}
          type={inputType}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          onInput={handleInput}
          className={cn(
            'h-9 w-full rounded-md border bg-surface-raised px-3 text-md',
            'placeholder:text-content-disabled transition-colors duration-fast',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/25',
            error ? 'border-danger-500' : 'border-stroke focus:border-brand-500',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-disabled',
            // Room for the toggle. `pe`, not `pr` — it moves to the left in Arabic.
            isPassword && 'pe-10',
            className,
          )}
          {...props}
        />

        {isPassword && !props.disabled && (
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            // The label states the action, and aria-pressed states the current
            // state — a screen reader user needs both to know what will happen.
            aria-label={revealed ? t('common.hidePassword') : t('common.showPassword')}
            aria-pressed={revealed}
            aria-controls={id}
            // Reachable by keyboard, but after the input — tabbing through a
            // login form should go email → password → submit.
            className={cn(
              'absolute inset-y-0 flex w-10 items-center justify-center',
              'text-content-tertiary transition-colors hover:text-content-primary',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px]',
            )}
            style={{ insetInlineEnd: 0 }}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-content-tertiary">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/* Inline rather than an icon package: two icons do not justify a dependency,
   and these inherit currentColor so they follow the theme for free. */

function EyeIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.9 5.7A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4.1M6.5 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.7 9.7 0 0 0 3.9-.8" />
      <path d="M10.1 10.1a2.75 2.75 0 0 0 3.8 3.8" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
