import type { PigoowaClient } from '@/services/supabase/client';

export async function deleteUserData(client: PigoowaClient): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = (await client.auth.getUser()).data.user?.id;
    if (!userId) return { ok: false, error: 'Brak aktywnego użytkownika' };

    // Delete by user_id
    const [medications, appointments] = await Promise.all([
      client.from('medications').delete().eq('user_id', userId),
      client.from('appointments').delete().eq('user_id', userId),
    ]);

    if (medications.error) return { ok: false, error: medications.error.message };
    if (appointments.error) return { ok: false, error: appointments.error.message };

    // Delete profile
    const profile = await client.from('profiles').delete().eq('id', userId);
    if (profile.error) return { ok: false, error: profile.error.message };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
