import type { PigoowaClient } from '@/services/supabase/client';
import { isValidTimeZone } from '@/utils/timeZone';
import { authFailureCodeOf } from './authErrors';
import type { AuthResult, AuthUser, Profile, ProfileApi } from './types';

// docs/DATABASE.md §3.1 and §8: `profiles.id` is the account id and has no default, so a signed-up user
// inserts her own row (`id = auth.uid()`); Row Level Security allows exactly that and nothing else. This is
// done by the client, once, after the first sign-in: no trigger on `auth.users` and no change to the schema.

interface QueryFailure {
  message: string;
  code?: string;
}

function failureCode(error: QueryFailure | null, status: number) {
  if (status === 0) return 'network-error' as const;
  if (status === 401 || error?.code?.startsWith('PGRST30')) return 'session-expired' as const;
  return authFailureCodeOf(error);
}

export function createSupabaseProfileApi(client: PigoowaClient): ProfileApi {
  async function read(user: AuthUser): Promise<AuthResult<Profile | null>> {
    const { data, error, status } = await client
      .from('profiles')
      .select('time_zone')
      .eq('id', user.id)
      .maybeSingle();
    if (error) return { ok: false, code: failureCode(error, status) };
    return { ok: true, value: data === null ? null : { timeZone: data.time_zone } };
  }

  return {
    async ensureProfile(user, browserTimeZone) {
      try {
        const existing = await read(user);
        if (!existing.ok) return existing;
        if (existing.value !== null) return { ok: true, value: existing.value };

        // The browser's zone is the default (PROJECT_SPEC DEC-10); the database refuses a name it does not
        // know, so a zone it rejects falls back to the column's own default (Europe/Warsaw).
        const zones = isValidTimeZone(browserTimeZone) ? [browserTimeZone, undefined] : [undefined];
        for (const timeZone of zones) {
          const inserted = await client
            .from('profiles')
            .insert(timeZone === undefined ? { id: user.id } : { id: user.id, time_zone: timeZone })
            .select('time_zone')
            .single();
          if (!inserted.error) return { ok: true, value: { timeZone: inserted.data.time_zone } };
          // 23505: another tab created it first. 23514: the zone was refused; try without it.
          if (inserted.error.code === '23505') break;
          if (inserted.error.code !== '23514') {
            return { ok: false, code: failureCode(inserted.error, inserted.status) };
          }
        }
        const again = await read(user);
        if (!again.ok) return again;
        return again.value === null
          ? { ok: false, code: 'unknown' }
          : { ok: true, value: again.value };
      } catch (error) {
        return { ok: false, code: authFailureCodeOf(error) };
      }
    },
  };
}
