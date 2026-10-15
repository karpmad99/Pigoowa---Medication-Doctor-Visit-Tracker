/** Joins class names, ignoring falsy values: cx('a', isOn && 'b') -> 'a b' or 'a'. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
