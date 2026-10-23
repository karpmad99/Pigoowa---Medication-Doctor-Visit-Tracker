import { describe, expect, it } from 'vitest';
import { checkPublicSupabaseKey } from './publicKey';

function jwt(payload: object): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('checkPublicSupabaseKey', () => {
  it('accepts a publishable key and a legacy anon JWT', () => {
    expect(checkPublicSupabaseKey('sb_publishable_abcdefghijklmnop')).toEqual({ ok: true });
    expect(checkPublicSupabaseKey(jwt({ role: 'anon', iss: 'supabase' }))).toEqual({ ok: true });
  });

  it('refuses a secret key', () => {
    const result = checkPublicSupabaseKey('sb_secret_abcdefghijklmnop');

    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('secret');
  });

  it('refuses a JWT with the service_role role, or any role but anon', () => {
    expect(checkPublicSupabaseKey(jwt({ role: 'service_role' }))).toMatchObject({ ok: false });
    expect(checkPublicSupabaseKey(jwt({ role: 'authenticated' }))).toMatchObject({ ok: false });
    expect(checkPublicSupabaseKey(jwt({}))).toMatchObject({ ok: false });
  });

  it('does not repeat the key in its explanation', () => {
    const secret = 'sb_secret_THIS_MUST_NOT_BE_PRINTED';

    const result = checkPublicSupabaseKey(secret);

    expect(JSON.stringify(result)).not.toContain('THIS_MUST_NOT_BE_PRINTED');
  });

  it.each(['', '   ', 'not-a-key', 'a.b', 'a.b.c', 'a.!!!.c'])('refuses %j', (value) => {
    expect(checkPublicSupabaseKey(value)).toMatchObject({ ok: false });
  });
});
