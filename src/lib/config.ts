// With the extension because vite.config.ts loads this file in Node (see there).
import { checkPublicSupabaseKey } from './publicKey.ts';

// What the application is built to do, decided by two PUBLIC environment variables (`.env.example`):
//
// - neither set: the demonstration version, exactly as before. Data is fictional and stays in this
//   browser (localStorage); there is no sign-in.
// - both set: accounts. The user signs in, and the data lives in that user's Supabase account, protected by
//   Row Level Security. The demonstration stays reachable from the sign-in page.
// - only one set, or a key that is not public: an error, reported instead of guessing.

export type AppConfig =
  | { kind: 'demo-only' }
  | { kind: 'accounts'; supabaseUrl: string; supabaseAnonKey: string }
  | { kind: 'invalid'; problem: string };

export interface EnvironmentVariables {
  VITE_SUPABASE_URL?: string | undefined;
  VITE_SUPABASE_ANON_KEY?: string | undefined;
}

export function readAppConfig(env: EnvironmentVariables): AppConfig {
  const url = env.VITE_SUPABASE_URL?.trim() ?? '';
  const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (url === '' && key === '') return { kind: 'demo-only' };
  if (url === '') return { kind: 'invalid', problem: 'VITE_SUPABASE_URL is missing.' };
  if (key === '') return { kind: 'invalid', problem: 'VITE_SUPABASE_ANON_KEY is missing.' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'invalid', problem: 'VITE_SUPABASE_URL is not a valid URL.' };
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocal)) {
    return {
      kind: 'invalid',
      problem: 'VITE_SUPABASE_URL must use https (http is accepted only for localhost).',
    };
  }
  const keyCheck = checkPublicSupabaseKey(key);
  if (!keyCheck.ok) {
    return {
      kind: 'invalid',
      problem: `VITE_SUPABASE_ANON_KEY is not a public key: ${keyCheck.reason}.`,
    };
  }
  return { kind: 'accounts', supabaseUrl: parsed.origin, supabaseAnonKey: key };
}
