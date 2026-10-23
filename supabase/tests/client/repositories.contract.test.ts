import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import { describeRepositoryContract } from '@/services/contract/repositoryContract';
import { createIdCodec, withReadableIds } from '@/services/contract/uuidIds';
import type { Repositories } from '@/services/repositories';
import type { Database } from '@/services/supabase/database.types';
import { createSupabaseRepositories } from '@/services/supabase/supabaseRepositories';

// ROADMAP Stage 11: "Repository contract tests pass against both implementations". This runs the SAME
// contract (src/services/contract) that the local implementation runs, against the Supabase repositories
// and a REAL local stack (`supabase start`): real Auth, real PostgREST, real Postgres with the migrations,
// Row Level Security and constraints. Nothing is mocked. Only the public URL and key are used.
//
// One user is created for the file; before every test the user's data is removed through the repositories
// themselves (deleting a medication cascades to its history and events), so each test starts empty.

const url = process.env.SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
if (url === '' || anonKey === '') {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required: run `npm run test:db-client`.');
}

const client = createClient<Database>(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

beforeAll(async () => {
  const signUp = await client.auth.signUp({
    email: `pigoowa-contract-${randomUUID()}@example.com`,
    password: randomUUID() + randomUUID(),
  });
  const user = signUp.data.user;
  if (signUp.error || !user || !signUp.data.session) {
    throw new Error(`sign up failed: ${signUp.error?.message ?? 'no session'}`);
  }
  const profile = await client.from('profiles').insert({ id: user.id });
  if (profile.error) throw new Error(`profile failed: ${profile.error.message}`);
});

// Ids are unique in the whole database and the contract's ids never change, so every run writes its own
// salt into them: what an interrupted earlier run left behind cannot collide.
const codec = createIdCodec(randomUUID().replace(/-/g, '').slice(0, 10));

async function removeEverything(repositories: Repositories): Promise<void> {
  for (const medication of await repositories.medications.list()) {
    await repositories.medications.remove(medication.id);
  }
  for (const appointment of await repositories.appointments.list()) {
    await repositories.appointments.remove(appointment.id);
  }
}

afterAll(async () => {
  await removeEverything(createSupabaseRepositories(client));
});

describeRepositoryContract('Supabase implementation (local stack)', async () => {
  const open = () => createSupabaseRepositories(client);
  await removeEverything(open());
  return {
    repositories: withReadableIds(open(), codec),
    reopen: () => withReadableIds(open(), codec),
    // A SQL NULL is both "left out" and "set to null".
    distinguishesNullFromAbsent: false,
  };
});
