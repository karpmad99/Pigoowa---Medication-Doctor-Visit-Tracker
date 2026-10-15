import type { ReactNode } from 'react';
import { cx } from '@/utils/cx';

interface CardProps {
  /** Use "section" with `aria-labelledby` when the card is a named part of the page. */
  as?: 'div' | 'section' | 'article';
  'aria-labelledby'?: string;
  className?: string;
  children: ReactNode;
}

export function Card({ as: Tag = 'div', className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cx('rounded-card border border-line bg-surface p-4 sm:p-6', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
