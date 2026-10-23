import { cx } from '@/utils/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost';
export type ButtonSize = 'md' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control px-4 text-base font-semibold ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-60';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-canvas',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
  // A destructive action that is offered but not encouraged: outlined, red text, never the main button.
  dangerOutline: 'border border-danger-600 bg-surface text-danger-700 hover:bg-danger-50',
  ghost: 'text-brand-700 hover:bg-brand-50',
};

// "md" is 48 px tall: a large touch target on phones, easy to hit for older users. "sm" is compact (36 px) only where a
// mouse is the likely pointer (from the tablet width up and not on a touch screen); on a phone it is
// 44 px too, so no button is hard to hit.
const sizes: Record<ButtonSize, string> = {
  md: 'min-h-12',
  sm: 'min-h-11 px-3 md:min-h-9 md:pointer-coarse:min-h-11',
};

/** Shared by Button and ButtonLink so a link that looks like a button is identical to one. */
export function buttonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  className?: string,
): string {
  return cx(base, variants[variant], sizes[size], className);
}
