import type { ComponentPropsWithRef } from 'react';
import { cx } from '@/utils/cx';
import { controlClasses } from './controls';

export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input className={cx(controlClasses, className)} {...rest} />;
}
