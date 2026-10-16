import { describe, expect, it } from 'vitest';
import { flashNotice, readFlashNotice } from './flashNotice';

describe('flash notice', () => {
  it('round-trips a message through router state', () => {
    expect(readFlashNotice(flashNotice('Dodano lek.').state)).toBe('Dodano lek.');
  });

  it.each([null, undefined, 'text', 42, {}, { notice: 7 }, { notice: null }, []])(
    'finds no message in %j',
    (state) => {
      expect(readFlashNotice(state)).toBeNull();
    },
  );
});
