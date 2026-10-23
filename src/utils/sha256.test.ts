import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

// The published vectors are from FIPS 180-2 (appendix B) and the usual empty-message value.
describe('sha256Hex: published test vectors', () => {
  it('hashes the empty text', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "abc" (one block)', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the 448-bit message (padding spills into a second block)', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes one million "a" (many blocks)', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

// For text beyond the published vectors, an independent implementation is the reference: the
// platform's own SHA-256 (Web Crypto). It is used here, in the tests only, and is not shipped.
async function referenceSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('sha256Hex: agrees with the platform implementation', () => {
  const texts: [string, string][] = [
    ['Polish letters (UTF-8, two bytes each)', 'Zażółć gęślą jaźń — Lek przykładowy'],
    ['symbols and an emoji (three and four bytes)', '€ µg ✓ 💊'],
    ['a stored collection text', '{"version":1,"items":[{"id":"a","doseUnit":"tabletka "}]}'],
    ['lengths around a block boundary (55 bytes)', 'x'.repeat(55)],
    ['lengths around a block boundary (56 bytes)', 'x'.repeat(56)],
    ['lengths around a block boundary (64 bytes)', 'x'.repeat(64)],
    ['a large text of mixed characters', 'Zażółć 💊 '.repeat(20_000)],
  ];

  it.each(texts)('%s', async (_name, text) => {
    expect(sha256Hex(text)).toBe(await referenceSha256(text));
  });

  it('hashes the exact text: one changed character or space changes the result', () => {
    const original = '{"version":1,"items":[]}';
    expect(sha256Hex(original)).not.toBe(sha256Hex(original + ' '));
    expect(sha256Hex(original)).not.toBe(sha256Hex(original.replace('1', '2')));
  });

  it('is 64 lowercase hexadecimal characters', () => {
    expect(sha256Hex('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});
