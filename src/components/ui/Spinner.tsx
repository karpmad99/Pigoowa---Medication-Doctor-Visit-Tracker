import { cx } from '@/utils/cx';

interface SpinnerProps {
  /** Announced to screen readers. */
  label?: string;
  /** Use inside something that already explains itself (e.g. a loading button). */
  decorative?: boolean;
  className?: string;
}

export function Spinner({ label = 'Ładowanie…', decorative = false, className }: SpinnerProps) {
  const ring = (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-5 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin',
        className,
      )}
    />
  );
  if (decorative) return ring;
  return (
    <span role="status" className="inline-flex items-center gap-2 text-ink-muted">
      {ring}
      <span>{label}</span>
    </span>
  );
}
