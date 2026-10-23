// The browser may hold only the PUBLIC key of a Supabase project (the "anon" / publishable key). A secret
// key in a `VITE_` variable would be copied into the bundle that every visitor downloads, and it bypasses
// Row Level Security. This check refuses the obvious mistakes; it cannot prove that a key is harmless, and
// it is no substitute for never putting a secret in the repository (ROADMAP Stage 11 and 12).

export type PublicKeyCheck = { ok: true } | { ok: false; reason: string };

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Accepts a publishable key (`sb_publishable_…`) or a legacy JWT whose role is `anon`; refuses anything else. */
export function checkPublicSupabaseKey(key: string): PublicKeyCheck {
  const trimmed = key.trim();
  if (trimmed === '') return { ok: false, reason: 'the key is empty' };
  if (trimmed.startsWith('sb_secret_')) {
    return {
      ok: false,
      reason: 'this is a secret key (sb_secret_…): it must never reach the browser',
    };
  }
  if (trimmed.startsWith('sb_publishable_')) return { ok: true };

  const payload = decodeJwtPayload(trimmed);
  if (payload === null) {
    return {
      ok: false,
      reason: 'the key is neither a publishable key nor a JWT with the anon role',
    };
  }
  if (payload.role !== 'anon') {
    return {
      ok: false,
      reason: `the key's role is "${typeof payload.role === 'string' ? payload.role : 'unknown'}", not "anon": it must never reach the browser`,
    };
  }
  return { ok: true };
}
