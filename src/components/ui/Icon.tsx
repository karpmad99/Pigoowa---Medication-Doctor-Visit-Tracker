import type { ReactNode } from 'react';
import { cx } from '@/utils/cx';

// A handful of simple inline SVG icons, so no icon library is needed. They are decorative:
// the visible text next to them carries the meaning, so they are hidden from screen readers.

export type IconName =
  | 'dashboard'
  | 'pill'
  | 'calendar'
  | 'check'
  | 'alert'
  | 'info'
  | 'close'
  | 'minus'
  | 'clock'
  | 'arrow-right';

const shapes: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  pill: (
    <g transform="rotate(-45 12 12)">
      <rect x="2" y="8" width="20" height="8" rx="4" />
      <path d="M12 8v8" />
    </g>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  minus: <path d="M5 12h14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx('size-5 shrink-0', className)}
    >
      {shapes[name]}
    </svg>
  );
}
