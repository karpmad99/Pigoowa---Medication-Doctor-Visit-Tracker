import type { ComponentPropsWithRef } from 'react';
import { cx } from '@/utils/cx';
import { controlClasses } from './controls';

export function Select({ className, ...rest }: ComponentPropsWithRef<'select'>) {
  return <select className={cx(controlClasses, className)} {...rest} />;
}
