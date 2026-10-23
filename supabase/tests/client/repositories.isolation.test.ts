import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseProfileApi } from '@/features/auth/profile';
import { createSupabaseAuthApi } from '@/features/auth/supabaseAuthApi';
import type { Repositories } from '@/services/repositories';
import { createSupabaseRepositories } from '@/services/supabase/supabaseRepositories';
import {
  makeAppointment,
  makeDoseLog,
  makeMedication,
  makeStockEvent,
  scheduleTime,
} from '@/test/fixtures';
import { asLocalDate, asLocalTime, asTimestamp } from '@/utils/date';
import { newClient, newCredentials, requireStack } from './helpers';

// ROADMAP Stage 11, "Two real users see only their own data": the same check as isolation.test.ts, but through
// the application's own Supabase repositories (the code the screens use) instead of raw table calls. Two
// independent clients, two real accounts, the real database with Row Level Security. Only the public key.

requireStack();

interface Account {
  repositories: Repositories;
  client: ReturnType<typeof newClient>;
  medicationId: string;
  scheduleTimeId: string;
  logId: string;
  appointmentId: string;
  eventId: string;
}

async function createAccount(label: string): Promise<Account> {
  const client = newClient();
  const credentials = newCredentials(label);
  const signedUp = await createSupabaseAuthApi(client).signUp(
    credentials.email,
    credentials.password,
  );
  if (!signedUp.ok || signedUp.value.user === null) throw new Error('sign up failed');
  const profile = await createSupabaseProfileApi(client).ensureProfile(
    signedUp.value.user,
    'Europe/Warsaw',
  );
  if (!profile.ok) throw new Error('profile failed');

  const repositories = createSupabaseRepositories(client);
  const medicationId = randomUUID();
  const scheduleTimeId = randomUUID();
  const logId = randomUUID();
  const appointmentId = randomUUID();
  const eventId = randomUUID();
  await repositories.medications.create(
    makeMedication({
      id: medicationId,
      name: `Lek ${label}`,
      scheduleTimes: [scheduleTime(scheduleTimeId, '08:00')],
      stock: { quantity: 20, unit: 'tabletka', asOf: asTimestamp('2026-10-01T08:00:00Z') },
    }),
  );
  await repositories.doseLogs.upsert(makeDoseLog({ id: logId, medicationId }));
  await repositories.appointments.create(
    makeAppointment({ id: appointmentId, doctorName: `dr ${label}` }),
  );
  await repositories.stockEvents.append(makeStockEvent({ id: eventId, medicationId }));
  return { repositories, client, medicationId, scheduleTimeId, logId, appointmentId, eventId };
}

let alice: Account;
let bob: Account;
const WHOLE_RANGE = [asLocalDate('2000-01-01'), asLocalDate('2999-12-31')] as const;

beforeAll(async () => {
  alice = await createAccount('alice');
  bob = await createAccount('bob');
});

describe('two accounts through the application’s repositories', () => {
  it('each account lists only its own data, in every collection', async () => {
    for (const [self, other] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      const medications = await self.repositories.medications.list();
      const appointments = await self.repositories.appointments.list();
      const logs = await self.repositories.doseLogs.listByDateRange(...WHOLE_RANGE);
      const events = await self.repositories.stockEvents.list();

      expect(medications.map((m) => m.id)).toEqual([self.medicationId]);
      expect(appointments.map((a) => a.id)).toEqual([self.appointmentId]);
      expect(logs.map((l) => l.id)).toEqual([self.logId]);
      expect(events.map((e) => e.id)).toEqual([self.eventId]);
      expect(JSON.stringify([medications, appointments, logs, events])).not.toContain(
        other.medicationId,
      );
    }
  });

  it('asking for the other account’s record by id is "not found", exactly as for a record that does not exist', async () => {
    await expect(bob.repositories.medications.get(alice.medicationId)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(bob.repositories.appointments.get(alice.appointmentId)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(bob.repositories.medications.get(randomUUID())).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('counts nothing and lists nothing for the other account’s medication', async () => {
    expect(await bob.repositories.doseLogs.countForMedication(alice.medicationId)).toBe(0);
    expect(await bob.repositories.stockEvents.countForMedication(alice.medicationId)).toBe(0);
    expect(await bob.repositories.stockEvents.listForMedication(alice.medicationId)).toEqual([]);
    // Her own is counted.
    expect(await alice.repositories.doseLogs.countForMedication(alice.medicationId)).toBe(1);
    expect(await alice.repositories.stockEvents.countForMedication(alice.medicationId)).toBe(1);
  });

  it('cannot change or delete the other account’s records: "not found", and they stay as they were', async () => {
    const stolen = makeMedication({ id: alice.medicationId, name: 'Przejęty' });
    await expect(bob.repositories.medications.update(stolen)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(bob.repositories.medications.remove(alice.medicationId)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(
      bob.repositories.appointments.update(
        makeAppointment({ id: alice.appointmentId, doctorName: 'Przejęty' }),
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(bob.repositories.appointments.remove(alice.appointmentId)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(
      bob.repositories.stockEvents.reverse(alice.eventId, asTimestamp('2026-10-20T08:00:00Z')),
    ).rejects.toMatchObject({ code: 'not-found' });

    expect((await alice.repositories.medications.get(alice.medicationId)).name).toBe('Lek alice');
    expect((await alice.repositories.appointments.get(alice.appointmentId)).doctorName).toBe(
      'dr alice',
    );
    expect((await alice.repositories.stockEvents.list())[0]?.reversedAt).toBeNull();
  });

  it('removing a slot that only the other account has a record in removes nothing', async () => {
    await bob.repositories.doseLogs.remove({
      medicationId: alice.medicationId,
      date: asLocalDate('2026-10-15'),
      time: asLocalTime('08:00'),
    });

    expect(await alice.repositories.doseLogs.listByDateRange(...WHOLE_RANGE)).toHaveLength(1);
  });

  it('cannot attach records to the other account’s medication', async () => {
    await expect(
      bob.repositories.doseLogs.upsert(
        makeDoseLog({
          id: randomUUID(),
          medicationId: alice.medicationId,
          scheduledDate: asLocalDate('2026-10-16'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'missing-reference' });
    // The slot Alice already used is refused as taken (the unique key is database-wide, so this answer
    // reveals that a record exists in that slot — to someone who already knows her unguessable medication id).
    await expect(
      bob.repositories.doseLogs.upsert(
        makeDoseLog({ id: randomUUID(), medicationId: alice.medicationId }),
      ),
    ).rejects.toMatchObject({ code: 'duplicate-slot' });
    await expect(
      bob.repositories.stockEvents.append(
        makeStockEvent({ id: randomUUID(), medicationId: alice.medicationId }),
      ),
    ).rejects.toMatchObject({ code: 'missing-reference' });
    expect(await alice.repositories.doseLogs.countForMedication(alice.medicationId)).toBe(1);
  });

  it('cannot take over the other account’s record by reusing its id (the id is taken, nothing changes)', async () => {
    await expect(
      bob.repositories.appointments.create(
        makeAppointment({ id: alice.appointmentId, doctorName: 'Przejęty' }),
      ),
    ).rejects.toMatchObject({ code: 'duplicate-id' });

    expect((await alice.repositories.appointments.get(alice.appointmentId)).doctorName).toBe(
      'dr alice',
    );
  });

  it('deleting an account’s medication deletes only its own history and events', async () => {
    const extra = await createAccount('carol');
    const bobEventsBefore = await bob.repositories.stockEvents.list();

    await extra.repositories.medications.remove(extra.medicationId);

    expect(await extra.repositories.doseLogs.listByDateRange(...WHOLE_RANGE)).toEqual([]);
    expect(await extra.repositories.stockEvents.list()).toEqual([]);
    expect(await bob.repositories.stockEvents.list()).toEqual(bobEventsBefore);
    expect(await bob.repositories.doseLogs.listByDateRange(...WHOLE_RANGE)).toHaveLength(1);
  });

  it('a signed-out client sees none of it', async () => {
    const anonymous = createSupabaseRepositories(newClient());

    await expect(anonymous.medications.list()).rejects.toMatchObject({ code: 'not-signed-in' });
    await expect(anonymous.medications.get(alice.medicationId)).rejects.toMatchObject({
      code: 'not-signed-in',
    });
  });
});

describe('reading more than one page of rows', () => {
  it('returns every intake record, although the server returns at most 1000 rows per request', async () => {
    const account = await createAccount('many');
    const medicationId = account.medicationId;
    const total = 1203;
    const rows = Array.from({ length: total }, (_, index) => {
      const day = new Date(Date.UTC(2020, 0, 1 + index));
      return {
        medication_id: medicationId,
        scheduled_date: day.toISOString().slice(0, 10),
        scheduled_time: '09:00',
        status: 'taken',
        dose_amount: 1,
        dose_unit: 'tabletka',
      };
    });
    for (let start = 0; start < rows.length; start += 400) {
      const inserted = await account.client
        .from('dose_logs')
        .insert(rows.slice(start, start + 400));
      expect(inserted.error).toBeNull();
    }

    const logs = await account.repositories.doseLogs.listByDateRange(...WHOLE_RANGE);

    // 1203 inserted here, plus the one record createAccount made.
    expect(logs).toHaveLength(total + 1);
    expect(new Set(logs.map((log) => log.id)).size).toBe(total + 1);
    // Still in the contract's order.
    const dates = logs.map((log) => log.scheduledDate);
    expect(dates).toEqual([...dates].sort());
    expect(await account.repositories.doseLogs.countForMedication(medicationId)).toBe(total + 1);
  });
});
