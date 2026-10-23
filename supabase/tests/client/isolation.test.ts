import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

// DATABASE.md §6, the part that needs real sessions: two accounts, each with its own independent
// Supabase JS client, against the LOCAL stack (`supabase start`). Only the public URL and the public
// (anon / publishable) key are used, exactly like the browser would; the service-role key is neither
// read nor needed. The keys come from the environment (scripts/db/run-client-isolation.sh reads them
// from `supabase status`), never from the repository.
//
// Both accounts are created here with random e-mail addresses and passwords. A user cannot delete its
// own account with the public key, so the accounts stay in the LOCAL database until `supabase db reset`.

const url = process.env.SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

interface Row {
  id: string;
  user_id?: string;
  [column: string]: unknown;
}
type Client = ReturnType<typeof newClient>;

interface Account {
  client: Client;
  userId: string;
  medicationId: string;
  scheduleTimeId: string;
  doseLogId: string;
  appointmentId: string;
  stockEventId: string;
}

function newClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signUp(label: string): Promise<{ client: Client; userId: string }> {
  const client = newClient();
  const { data, error } = await client.auth.signUp({
    email: `pigoowa-${label}-${randomUUID()}@example.com`,
    password: randomUUID() + randomUUID(),
  });
  if (error) throw new Error(`sign up failed: ${error.message}`);
  if (!data.session || !data.user) {
    throw new Error(
      'sign up returned no session: e-mail confirmation must be off in the local config',
    );
  }
  return { client, userId: data.user.id };
}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error || result.data === null)
    throw new Error(`${what}: ${result.error?.message ?? 'no data'}`);
  return result.data;
}

async function createAccount(label: string): Promise<Account> {
  const { client, userId } = await signUp(label);
  must(
    await client.from('profiles').insert({ id: userId, display_name: label }).select(),
    'profile',
  );
  const [medication] = must<Row[]>(
    await client
      .from('medications')
      .insert({
        name: `${label} medication`,
        dose_unit: 'tabletka',
        start_date: '2026-01-01',
        schedule_effective_from: '2026-01-01',
        stock_quantity: 20,
        stock_unit: 'tabletka',
        stock_as_of: new Date().toISOString(),
      })
      .select(),
    'medication',
  );
  const medicationId = medication?.id ?? '';
  const [scheduleTime] = must<Row[]>(
    await client
      .from('medication_schedule_times')
      .insert({ medication_id: medicationId, time_of_day: '08:00', dose_amount: 1 })
      .select(),
    'schedule time',
  );
  const [doseLog] = must<Row[]>(
    await client
      .from('dose_logs')
      .insert({
        medication_id: medicationId,
        scheduled_date: '2026-01-05',
        scheduled_time: '08:00',
        status: 'taken',
        dose_amount: 1,
        dose_unit: 'tabletka',
      })
      .select(),
    'dose log',
  );
  const [appointment] = must<Row[]>(
    await client
      .from('appointments')
      .insert({ doctor_name: `${label} doctor`, scheduled_at: '2026-03-01T10:00:00Z' })
      .select(),
    'appointment',
  );
  const stockEventId = randomUUID();
  must(
    await client
      .from('stock_events')
      .insert({
        id: stockEventId,
        medication_id: medicationId,
        kind: 'refill',
        amount: 10,
        unit: 'tabletka',
      })
      .select(),
    'stock event',
  );
  return {
    client,
    userId,
    medicationId,
    scheduleTimeId: scheduleTime?.id ?? '',
    doseLogId: doseLog?.id ?? '',
    appointmentId: appointment?.id ?? '',
    stockEventId,
  };
}

const TABLES = [
  'profiles',
  'medications',
  'medication_schedule_times',
  'dose_logs',
  'appointments',
  'stock_events',
] as const;

let alice: Account;
let bob: Account;

describe.skipIf(url === '' || anonKey === '')('two independent Supabase JS sessions', () => {
  beforeAll(async () => {
    alice = await createAccount('alice');
    bob = await createAccount('bob');
  });

  it('are two different users with two different sessions', async () => {
    const a = (await alice.client.auth.getUser()).data.user?.id;
    const b = (await bob.client.auth.getUser()).data.user?.id;

    expect(a).toBe(alice.userId);
    expect(b).toBe(bob.userId);
    expect(a).not.toBe(b);
  });

  it.each(TABLES)('%s: each user reads exactly her own rows', async (table) => {
    for (const [self, other] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      const { data, error } = await self.client.from(table).select('*');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = (data as Row[])[0];
      expect(table === 'profiles' ? row?.id : row?.user_id).toBe(self.userId);
      expect(JSON.stringify(data)).not.toContain(other.userId);
    }
  });

  it("asking for the other user's row by id returns nothing, without an error", async () => {
    const probes = [
      ['profiles', 'id', bob.userId],
      ['medications', 'id', bob.medicationId],
      ['medication_schedule_times', 'id', bob.scheduleTimeId],
      ['dose_logs', 'id', bob.doseLogId],
      ['appointments', 'id', bob.appointmentId],
      ['stock_events', 'id', bob.stockEventId],
    ] as const;

    for (const [table, column, value] of probes) {
      const { data, error } = await alice.client.from(table).select('*').eq(column, value);

      expect({ table, error, data }).toEqual({ table, error: null, data: [] });
    }
  });

  it('cannot insert rows owned by the other user', async () => {
    const attempts = [
      alice.client.from('medications').insert({
        user_id: bob.userId,
        name: 'planted',
        dose_unit: 'u',
        start_date: '2026-01-01',
        schedule_effective_from: '2026-01-01',
      }),
      alice.client.from('appointments').insert({
        user_id: bob.userId,
        doctor_name: 'planted',
        scheduled_at: '2026-03-01T10:00:00Z',
      }),
      alice.client.from('profiles').insert({ id: bob.userId, display_name: 'planted' }),
      alice.client.from('stock_events').insert({
        id: randomUUID(),
        user_id: bob.userId,
        medication_id: bob.medicationId,
        kind: 'refill',
        amount: 1,
        unit: 'tabletka',
      }),
    ];

    for (const attempt of await Promise.all(attempts)) {
      expect(attempt.error?.code).toBe('42501');
    }
  });

  it("cannot attach her own rows to the other user's medication (composite foreign key)", async () => {
    const schedule = await alice.client
      .from('medication_schedule_times')
      .insert({ medication_id: bob.medicationId, time_of_day: '12:00', dose_amount: 1 });
    const dose = await alice.client.from('dose_logs').insert({
      medication_id: bob.medicationId,
      scheduled_date: '2026-01-06',
      scheduled_time: '08:00',
      status: 'taken',
      dose_amount: 1,
      dose_unit: 'tabletka',
    });
    const stock = await alice.client.from('stock_events').insert({
      id: randomUUID(),
      medication_id: bob.medicationId,
      kind: 'waste',
      amount: 1,
      unit: 'tabletka',
    });

    expect(schedule.error?.code).toBe('23503');
    expect(dose.error?.code).toBe('23503');
    expect(stock.error?.code).toBe('23503');
  });

  it('cannot hand her own rows over to the other user', async () => {
    const medication = await alice.client
      .from('medications')
      .update({ user_id: bob.userId })
      .eq('id', alice.medicationId);
    const appointment = await alice.client
      .from('appointments')
      .update({ user_id: bob.userId })
      .eq('id', alice.appointmentId);

    expect(medication.error).not.toBeNull();
    expect(appointment.error).not.toBeNull();
  });

  it("updates and deletes aimed at the other user's rows touch nothing", async () => {
    const updates = await Promise.all([
      alice.client
        .from('medications')
        .update({ name: 'hacked' })
        .eq('id', bob.medicationId)
        .select(),
      alice.client
        .from('medication_schedule_times')
        .update({ dose_amount: 99 })
        .eq('id', bob.scheduleTimeId)
        .select(),
      alice.client.from('dose_logs').update({ status: 'skipped' }).eq('id', bob.doseLogId).select(),
      alice.client
        .from('appointments')
        .update({ doctor_name: 'hacked' })
        .eq('id', bob.appointmentId)
        .select(),
      alice.client
        .from('profiles')
        .update({ display_name: 'hacked' })
        .eq('id', bob.userId)
        .select(),
      alice.client
        .from('stock_events')
        .update({ reversed_at: new Date().toISOString() })
        .eq('id', bob.stockEventId)
        .select(),
    ]);
    for (const result of updates) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    const deletes = await Promise.all([
      alice.client.from('medications').delete().eq('id', bob.medicationId).select(),
      alice.client.from('medication_schedule_times').delete().eq('id', bob.scheduleTimeId).select(),
      alice.client.from('dose_logs').delete().eq('id', bob.doseLogId).select(),
      alice.client.from('appointments').delete().eq('id', bob.appointmentId).select(),
    ]);
    for (const result of deletes) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }

    // Bob's data, read by Bob, is exactly as it was.
    const { data: medication } = await bob.client
      .from('medications')
      .select('name')
      .eq('id', bob.medicationId);
    const { data: dose } = await bob.client
      .from('dose_logs')
      .select('status')
      .eq('id', bob.doseLogId);
    const { data: appointment } = await bob.client
      .from('appointments')
      .select('doctor_name')
      .eq('id', bob.appointmentId);
    const { data: event } = await bob.client
      .from('stock_events')
      .select('reversed_at')
      .eq('id', bob.stockEventId);
    const { data: profile } = await bob.client
      .from('profiles')
      .select('display_name')
      .eq('id', bob.userId);

    expect(medication).toEqual([{ name: 'bob medication' }]);
    expect(dose).toEqual([{ status: 'taken' }]);
    expect(appointment).toEqual([{ doctor_name: 'bob doctor' }]);
    expect(event).toEqual([{ reversed_at: null }]);
    expect(profile).toEqual([{ display_name: 'bob' }]);
  });

  it('each user can change her own data', async () => {
    const medication = await alice.client
      .from('medications')
      .update({ name: 'alice medication v2' })
      .eq('id', alice.medicationId)
      .select();
    const dose = await alice.client
      .from('dose_logs')
      .update({ taken_amount: 0.5, note: 'half' })
      .eq('id', alice.doseLogId)
      .select();

    expect(medication.error).toBeNull();
    expect((medication.data as Row[])[0]?.name).toBe('alice medication v2');
    expect(dose.error).toBeNull();
    expect((dose.data as Row[])[0]?.taken_amount).toBe(0.5);
  });

  it('stock events: only reversed_at can be set, once, and a stock event cannot be deleted', async () => {
    const amount = await bob.client
      .from('stock_events')
      .update({ amount: 1 })
      .eq('id', bob.stockEventId);
    const reverse = await bob.client
      .from('stock_events')
      .update({ reversed_at: new Date().toISOString() })
      .eq('id', bob.stockEventId)
      .select();
    const again = await bob.client
      .from('stock_events')
      .update({ reversed_at: new Date(Date.now() + 1000).toISOString() })
      .eq('id', bob.stockEventId);
    const remove = await bob.client
      .from('stock_events')
      .delete()
      .eq('id', bob.stockEventId)
      .select();
    const stillThere = await bob.client
      .from('stock_events')
      .select('id')
      .eq('id', bob.stockEventId);

    expect(amount.error?.code).toBe('23514');
    expect(reverse.error).toBeNull();
    expect(reverse.data).toHaveLength(1);
    expect(again.error?.code).toBe('23514');
    expect(remove.error?.code).toBe('42501');
    expect(stillThere.data).toHaveLength(1);
  });

  it('a signed-out client (public key only) reads and writes nothing', async () => {
    const anonymous = newClient();

    for (const table of TABLES) {
      const read = await anonymous.from(table).select('*');

      expect(read.error?.code, table).toBe('42501');
      expect(read.data, table).toBeNull();
    }
    const write = await anonymous.from('appointments').insert({
      user_id: alice.userId,
      doctor_name: 'planted',
      scheduled_at: '2026-03-01T10:00:00Z',
    });
    const remove = await anonymous.from('medications').delete().eq('id', alice.medicationId);

    expect(write.error?.code).toBe('42501');
    expect(remove.error?.code).toBe('42501');
  });

  it('a user can delete her own medication, and it takes only its own children with it', async () => {
    const removed = await alice.client
      .from('medications')
      .delete()
      .eq('id', alice.medicationId)
      .select();

    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    for (const table of ['medication_schedule_times', 'dose_logs', 'stock_events'] as const) {
      const { data } = await alice.client.from(table).select('id');
      expect(data, table).toEqual([]);
    }
    const { data: bobDoses } = await bob.client.from('dose_logs').select('id');
    expect(bobDoses).toHaveLength(1);
  });
});
