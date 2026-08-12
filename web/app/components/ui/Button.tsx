import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '~/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-2 rounded-sm',
  md: 'h-9 px-4 text-md gap-2 rounded-md',
  lg: 'h-11 px-5 text-lg gap-2 rounded-md',
};

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 ' +
    'disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none',
  secondary:
    'bg-surface-raised text-content-primary border border-stroke shadow-xs ' +
    'hover:bg-surface-hover active:bg-surface-active disabled:text-content-disabled',
  ghost:
    'bg-transparent text-content-secondary hover:bg-surface-hover ' +
    'hover:text-content-primary disabled:text-content-disabled',
  danger:
    'bg-danger-500 text-white shadow-xs hover:bg-danger-600 active:bg-danger-700 ' +
    'disabled:bg-neutral-300 disabled:text-neutral-500',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    fullWidth = false,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // A loading button stays disabled, so a double-click cannot submit twice.
      // That is the most common source of duplicate records in any form.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap font-medium',
        'transition-colors duration-fast ease-out disabled:cursor-not-allowed',
        SIZES[size],
        VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  );
}
