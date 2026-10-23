import type { ReactNode } from 'react';
import { cx } from '@/utils/cx';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-800',
  brand: 'bg-brand-100 text-brand-700',
  success: 'bg-success-50 text-success-800',
  warning: 'bg-warning-50 text-warning-800',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-800',
};

/** A short status label. The colour only reinforces the text, which always says the status. */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
