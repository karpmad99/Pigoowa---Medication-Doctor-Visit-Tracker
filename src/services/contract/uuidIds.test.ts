import { describe, expect, it } from 'vitest';
import { createIdCodec, idToUuid, uuidToId } from './uuidIds';

describe('the test id translation', () => {
  it('turns a readable id into a UUID and back', () => {
    const uuid = idToUuid('med-1');

    expect(uuid).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(uuidToId(uuid)).toBe('med-1');
  });

  it('keeps the order of the readable ids, including a prefix before its longer id', () => {
    const ids = ['a', 'a-1', 'a-10', 'a-2', 'b', 'm-2', 'm-5'];

    const byUuid = [...ids].sort((a, b) => (idToUuid(a) < idToUuid(b) ? -1 : 1));

    expect(byUuid).toEqual([...ids].sort());
  });

  it('writes a per-run salt after the padding: it is removed again and does not change the order', () => {
    const codec = createIdCodec('a1b2c3d4e5');

    expect(codec.toId(codec.toUuid('med-1'))).toBe('med-1');
    expect(codec.toUuid('med-1')).not.toBe(idToUuid('med-1'));
    expect(codec.toUuid('m-2') < codec.toUuid('m-5')).toBe(true);
    expect(codec.toUuid('a') < codec.toUuid('a-1')).toBe(true);
    // Another run's salt is not this run's id.
    expect(codec.toId(createIdCodec('0000000000').toUuid('med-1'))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('leaves a real UUID alone', () => {
    const real = '3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f';

    expect(uuidToId(real)).toBe(real);
  });

  it('gives an id that is too long for a readable one its own valid UUID, the same every time', () => {
    const uuid = idToUuid('no-such-medication');

    expect(uuid).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(idToUuid('no-such-medication')).toBe(uuid);
    expect(idToUuid('no-such-appointment')).not.toBe(uuid);
    expect(uuidToId(uuid)).toBe(uuid);
  });

  it('leaves a blank id as it is, so a repository still has to refuse it', () => {
    expect(idToUuid(' ')).toBe(' ');
    expect(idToUuid('')).toBe('');
  });
});
