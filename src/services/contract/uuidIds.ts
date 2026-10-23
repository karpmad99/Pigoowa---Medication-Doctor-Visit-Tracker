import type { Medication } from '@/features/medications/types';
import type { Repositories } from '../repositories';

// The shared repository contract (./repositoryContract.ts) uses readable ids such as 'm-1'. The database
// stores ids as UUIDs, and the application always creates UUIDs (src/utils/id.ts). To run the SAME contract
// tests against the database without editing them, this wraps repositories so that every id is translated
// on the way in and back on the way out.
//
// The translation is stateless and ORDER-PRESERVING: the characters of the id are written into the bytes of
// the UUID (padded with zero bytes), so sorting by UUID gives the same order as sorting by the readable id,
// which some contract tests check (equal names are ordered by id). It is a test tool: nothing in the
// application uses it.

const UUID_BYTES = 16;

export interface IdCodec {
  toUuid: (id: string) => string;
  toId: (uuid: string) => string;
}

/**
 * `salt` (hex) is written into the LAST bytes of every UUID. Ids are unique in the whole database, not
 * per user, and the contract's ids are always the same ('m-1'), so rows left behind by an earlier run
 * would collide with the next run's. A different salt per run avoids that. The salt follows the zero
 * padding, so it never changes the order.
 */
function codecFreeUuid(id: string, room: number, saltBytes: number[]): string {
  let hash = 0x811c9dc5;
  const bytes = [0xff];
  for (let index = 1; index < room; index += 1) {
    for (const code of new TextEncoder().encode(`${id}#${String(index)}`)) {
      hash = Math.imul(hash ^ code, 0x01000193) >>> 0;
    }
    bytes.push(hash & 0xff);
  }
  const hex = [...bytes, ...saltBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createIdCodec(salt = ''): IdCodec {
  const saltBytes = (salt.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16));
  const room = UUID_BYTES - saltBytes.length;

  function toUuid(id: string): string {
    // A blank id is not an id at all: it stays as it is, so the repository under test still sees (and must
    // refuse) a blank one instead of a perfectly valid UUID made of spaces.
    if (id.trim() === '') return id;
    const bytes = new TextEncoder().encode(id);
    if (bytes.length > room) {
      // Too long to carry readably (a made-up id of a medication that does not exist): a valid UUID that
      // is the same for the same text, cannot be mistaken for a readable one, and is not in the database.
      return codecFreeUuid(id, room, saltBytes);
    }
    const hex = [...bytes, ...new Array<number>(room - bytes.length).fill(0), ...saltBytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** The readable id a UUID made by `toUuid` stands for; any other UUID is returned unchanged. */
  function toId(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/i.test(hex)) return uuid;
    const bytes = (hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16));
    if (saltBytes.some((byte, index) => bytes[room + index] !== byte)) return uuid;
    const text = bytes.slice(0, room);
    const used = text.findLastIndex((byte) => byte !== 0) + 1;
    const readable = text.slice(0, used);
    if (used === 0 || readable.some((byte) => byte < 0x20 || byte > 0x7e)) return uuid;
    return new TextDecoder().decode(Uint8Array.from(readable));
  }

  return { toUuid, toId };
}

const defaultCodec = createIdCodec();
export const idToUuid = defaultCodec.toUuid;
export const uuidToId = defaultCodec.toId;

const ID_KEYS = new Set(['id', 'medicationId']);

function mapIds<T>(value: T, translate: (id: string) => string): T {
  if (Array.isArray(value)) return value.map((item: unknown) => mapIds(item, translate)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        ID_KEYS.has(key) && typeof entry === 'string' ? translate(entry) : mapIds(entry, translate),
      ]),
    ) as T;
  }
  return value;
}

// In the database a schedule time's id is a primary key of its own table, so it must be unique among ALL of a
// user's medications (the application creates UUIDs, so it is). The contract's fixtures reuse 't-1' in every
// medication, as the local storage allows: the translation makes each schedule-time id belong to its
// medication by writing "<medication id>:<schedule time id>" into the UUID.
function medicationIn(codec: IdCodec, medication: Medication): Medication {
  return {
    ...mapIds(medication, codec.toUuid),
    scheduleTimes: medication.scheduleTimes.map((time) => ({
      ...time,
      id: codec.toUuid(`${medication.id}:${time.id}`),
    })),
  };
}

function medicationOut(codec: IdCodec, medication: Medication): Medication {
  const readable = mapIds(medication, codec.toId);
  return {
    ...readable,
    scheduleTimes: readable.scheduleTimes.map((time) => ({
      ...time,
      id: time.id.slice(time.id.indexOf(':') + 1),
    })),
  };
}

export function withReadableIds(
  repositories: Repositories,
  codec: IdCodec = defaultCodec,
): Repositories {
  const idToUuid = codec.toUuid;
  const inn = <T>(value: T): T => mapIds(value, codec.toUuid);
  const out = <T>(value: T): T => mapIds(value, codec.toId);
  const { medications, doseLogs, appointments, stockEvents } = repositories;
  return {
    medications: {
      list: async () => (await medications.list()).map((m) => medicationOut(codec, m)),
      get: async (id) => medicationOut(codec, await medications.get(idToUuid(id))),
      create: async (medication) =>
        medicationOut(codec, await medications.create(medicationIn(codec, medication))),
      update: async (medication) =>
        medicationOut(codec, await medications.update(medicationIn(codec, medication))),
      remove: (id) => medications.remove(idToUuid(id)),
    },
    doseLogs: {
      listByDateRange: async (from, to) => out(await doseLogs.listByDateRange(from, to)),
      upsert: async (log) => out(await doseLogs.upsert(inn(log))),
      remove: (slot) => doseLogs.remove(inn(slot)),
      countForMedication: (id) => doseLogs.countForMedication(idToUuid(id)),
    },
    appointments: {
      list: async () => out(await appointments.list()),
      get: async (id) => out(await appointments.get(idToUuid(id))),
      create: async (appointment) => out(await appointments.create(inn(appointment))),
      update: async (appointment) => out(await appointments.update(inn(appointment))),
      remove: (id) => appointments.remove(idToUuid(id)),
    },
    stockEvents: {
      list: async () => out(await stockEvents.list()),
      listForMedication: async (id) => out(await stockEvents.listForMedication(idToUuid(id))),
      append: async (event) => out(await stockEvents.append(inn(event))),
      reverse: async (id, reversedAt) => out(await stockEvents.reverse(idToUuid(id), reversedAt)),
      countForMedication: (id) => stockEvents.countForMedication(idToUuid(id)),
    },
  };
}
