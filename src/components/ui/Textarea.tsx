import type { ComponentPropsWithRef } from 'react';
import { cx } from '@/utils/cx';
import { controlClasses } from './controls';

export function Textarea({ className, rows = 4, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea rows={rows} className={cx(controlClasses, className)} {...rest} />;
}
