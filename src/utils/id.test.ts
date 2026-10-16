import { describe, expect, it } from 'vitest';
import { createId } from './id';

describe('createId', () => {
  it('creates distinct UUIDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createId()));

    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
