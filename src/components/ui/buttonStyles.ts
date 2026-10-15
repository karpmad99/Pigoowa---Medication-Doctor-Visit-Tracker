import { cx } from '@/utils/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-60';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-canvas',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
  ghost: 'text-brand-700 hover:bg-brand-50',
};

// "md" is 44 px tall: a comfortable touch target on phones.
const sizes: Record<ButtonSize, string> = {
  md: 'min-h-11',
  sm: 'min-h-9 px-3',
};

/** Shared by Button and ButtonLink so a link that looks like a button is identical to one. */
export function buttonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  className?: string,
): string {
  return cx(base, variants[variant], sizes[size], className);
}
