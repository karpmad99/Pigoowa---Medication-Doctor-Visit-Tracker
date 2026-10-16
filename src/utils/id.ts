import type { Id } from '@/types/primitives';

/** A new random identifier (UUID v4). IDs are created by callers and passed into the domain functions. */
export function createId(): Id {
  return crypto.randomUUID();
}
