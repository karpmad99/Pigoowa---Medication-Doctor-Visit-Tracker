import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DOSE_NOTE_MAX } from '@/features/doses/logic/limits';
import { APPOINTMENT_LIMITS } from '@/features/appointments/logic/validation';
import { DOSAGE_FORMS, STRENGTH_UNITS } from '@/features/medications/logic/dosageForms';
import { MEDICATION_LIMITS } from '@/features/medications/logic/limits';
import { MAX_UNIT_LENGTH } from '@/features/medications/logic/stock';
import { MAX_QUANTITY } from '@/utils/quantity';

// ROADMAP stage 10: the SQL migrations are the second place the rules live. These tests cannot run the
// database (that is `scripts/db/run-tests.sh` / `supabase test db`); they keep the SQL files and the
// application's own lists and limits from drifting apart, and keep keys out of the code.

const sql = import.meta.glob<string>('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const pgTapFiles = import.meta.glob<string>('/supabase/tests/database/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '/index.html', '/vite.config.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const dbTooling = import.meta.glob<string>(
  ['/supabase/tests/client/*.ts', '/scripts/db/*.sh', '/supabase/config.toml', '/package.json'],
  { query: '?raw', import: 'default', eager: true },
);

const migrations = Object.entries(sql).sort(([a], [b]) => a.localeCompare(b));
const allSql = migrations.map(([, text]) => text).join('\n');
// Comments hold prose such as "no service_role" on purpose; the rules below are about statements.
const statements = allSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

const TABLES = [
  'profiles',
  'medications',
  'medication_schedule_times',
  'dose_logs',
  'appointments',
  'stock_events',
];

function checkList(constraint: string): string[] {
  const match = new RegExp(
    `constraint ${constraint} check \\(([^;]*?)\\),?\\n\\s*(?:constraint|\\))`,
    's',
  ).exec(statements);
  if (!match?.[1]) throw new Error(`constraint ${constraint} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
}

describe('supabase migrations', () => {
  it('are timestamp-named and sort in the order they must run', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(3);
    for (const [path] of migrations) expect(path).toMatch(/\/\d{14}_[a-z_]+\.sql$/);
  });

  it('create exactly the tables of docs/DATABASE.md', () => {
    const created = [...statements.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);

    expect([...created].sort()).toEqual([...TABLES].sort());
  });

  it('enable row level security on every table they create, and never disable it', () => {
    for (const table of TABLES) {
      expect(statements, table).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      );
    }
    expect(statements).not.toMatch(/disable row level security/i);
    expect(statements).not.toMatch(/no force row level security/i);
  });

  it('give every table a policy per command it can use, scoped to authenticated and to the owner', () => {
    for (const table of TABLES) {
      const policies = [
        ...statements.matchAll(
          new RegExp(`create policy \\w+ on public\\.${table}\\s+for (\\w+) to (\\w+)`, 'g'),
        ),
      ];
      const commands = policies.map((p) => p[1]).sort();
      const expected =
        table === 'stock_events' || table === 'profiles'
          ? ['insert', 'select', 'update']
          : ['delete', 'insert', 'select', 'update'];

      expect(commands, table).toEqual(expected);
      for (const p of policies) expect(p[2], table).toBe('authenticated');
    }
    expect(statements).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(statements).not.toMatch(/with check\s*\(\s*true\s*\)/i);
  });

  it('never grant anything to anon or public, and never use a privileged or elevated mechanism', () => {
    expect(statements).not.toMatch(/grant[^;]*\bto\b[^;]*\b(anon|public)\b/i);
    expect(statements).not.toMatch(/security definer/i);
    expect(statements).not.toMatch(/service_role/i);
    expect(statements).not.toMatch(/bypassrls/i);
    // The policies use the cached form, as docs/DATABASE.md prescribes.
    expect(statements).toMatch(/\(select auth\.uid\(\)\)/);
    expect(statements).not.toMatch(/[^(]\bauth\.uid\(\)\s*=/);
  });

  it('pin the search_path of every function', () => {
    const functions = [...statements.matchAll(/create function [\s\S]*?\$\$;/g)].map((m) => m[0]);

    expect(functions.length).toBeGreaterThan(0);
    for (const fn of functions) expect(fn).toMatch(/set search_path = ''/);
  });

  it('accept exactly the dosage forms and strength units of the application', () => {
    expect(checkList('medications_dosage_form_values').filter((v) => v !== 'dosage_form')).toEqual(
      DOSAGE_FORMS.map((form) => form.value),
    );
    expect(checkList('medications_strength_unit_values')).toEqual([...STRENGTH_UNITS]);
  });

  it('use the application limits for text lengths', () => {
    expect(allSql).toContain(
      `char_length(btrim(name)) between 1 and ${String(MEDICATION_LIMITS.name)}`,
    );
    expect(allSql).toContain(`between 1 and ${String(MEDICATION_LIMITS.doseUnit)}`);
    expect(allSql).toContain(`char_length(btrim(notes)) <= ${String(MEDICATION_LIMITS.notes)}`);
    expect(allSql).toContain(`char_length(btrim(note)) <= ${String(DOSE_NOTE_MAX)}`);
    expect(allSql).toContain(
      `char_length(btrim(doctor_name)) <= ${String(APPOINTMENT_LIMITS.doctorName)}`,
    );
    expect(allSql).toContain(
      `char_length(btrim(specialty)) <= ${String(APPOINTMENT_LIMITS.specialty)}`,
    );
    expect(allSql).toContain(
      `char_length(btrim(location)) <= ${String(APPOINTMENT_LIMITS.location)}`,
    );
    expect(allSql).toContain(`char_length(btrim(notes)) <= ${String(APPOINTMENT_LIMITS.notes)}`);
    expect(MAX_UNIT_LENGTH).toBe(MEDICATION_LIMITS.doseUnit);
  });

  it('store quantities with the precision of the application (3 decimals, up to 9 999 999.999)', () => {
    expect(MAX_QUANTITY).toBe(9_999_999.999);
    const quantityColumns = [...statements.matchAll(/^\s+(\w+)\s+numeric\((\d+),\s*(\d+)\)/gm)];

    expect(quantityColumns.length).toBe(7);
    for (const [, column, precision, scale] of quantityColumns) {
      expect([precision, scale], column).toEqual(['10', '3']);
    }
    expect(statements).not.toMatch(/\b(real|double precision|float\d?)\b/i);
  });

  it('keep stock-event kinds and dose statuses in step with the application types', () => {
    expect(checkList('stock_events_kind_values')).toEqual(['refill', 'waste']);
    expect(checkList('dose_logs_status_values')).toEqual(['taken', 'skipped']);
    expect(checkList('medications_stock_basis_values')).toEqual(['counted', 'new-package']);
  });

  it('seed no user data (demo data stays in the browser; seed rows would need accounts)', () => {
    const seed = import.meta.glob<string>('/supabase/seed.sql', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const text = Object.values(seed).join('\n');
    const withoutComments = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim();

    expect(withoutComments).toBe('');
  });
});

describe('database tests', () => {
  it('cover the tables, RLS on every table, two accounts, and the constraints', () => {
    const names = Object.keys(pgTapFiles).map((path) => path.split('/').pop());

    expect(names).toEqual([
      '01_rls_and_privileges.sql',
      '02_cross_user_isolation.sql',
      '03_constraints.sql',
      '04_triggers_and_cascades.sql',
    ]);
    const all = Object.values(pgTapFiles).join('\n');
    for (const table of TABLES) expect(all, table).toContain(table);
    expect(all).toContain('relrowsecurity');
  });
});

describe('secrets', () => {
  const files = Object.entries(sources).filter(
    ([path]) => !path.endsWith('databaseSchema.test.ts'),
  );

  it('scans the application sources (the glob is not empty)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  // The only files that may NAME a secret key (or hold an obviously fake key): the check that refuses one, and its tests.
  const KEY_CHECK_FILES = [
    '/src/lib/publicKey.ts',
    '/src/lib/publicKey.test.ts',
    '/src/lib/config.test.ts',
  ];

  it('has no service-role key, secret key or JWT in the code the browser receives', () => {
    for (const [path, text] of files) {
      if (!KEY_CHECK_FILES.includes(path)) {
        expect(text, path).not.toMatch(/service_role/i);
        expect(text, path).not.toMatch(/sb_secret_/);
      }
      expect(text, path).not.toMatch(
        /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
      );
      if (!KEY_CHECK_FILES.includes(path))
        expect(text, path).not.toMatch(/sb_publishable_[A-Za-z0-9_-]{10,}/);
      expect(text, path).not.toMatch(/postgres(ql)?:\/\/\w+:\w+@/);
      expect(text, path).not.toMatch(/\.supabase\.co/);
    }
  });

  it('imports the Supabase client only in the places meant to: the client, the auth feature and the repositories', () => {
    const allowed = [
      /^\/src\/lib\//,
      /^\/src\/services\/supabase\//,
      /^\/src\/features\/auth\//,
      /^\/src\/app\//,
      /^\/src\/main\.tsx$/,
    ];
    const importers = files
      .filter(([, text]) => text.includes("from '@supabase/supabase-js'"))
      .map(([path]) => path);

    expect(importers.length).toBeGreaterThan(0);
    for (const path of importers) {
      expect(
        allowed.some((pattern) => pattern.test(path)),
        path,
      ).toBe(true);
    }
  });

  it('has no key in the database tooling either: the client test reads the public key from the environment', () => {
    const entries = Object.entries(dbTooling);

    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (const [path, text] of entries) {
      expect(text, path).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./);
      expect(text, path).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/);
      // config.toml documents the role in its generated comments; the code that talks to the stack must not use it.
      if (!path.endsWith('config.toml'))
        expect(text, path).not.toMatch(/SERVICE_ROLE|service_role/);
    }
  });

  it('ships only the public client: supabase-js and TanStack Query are dependencies, and no key is in package.json', () => {
    const manifest = z
      .object({
        dependencies: z.record(z.string(), z.string()),
        devDependencies: z.record(z.string(), z.string()),
      })
      .parse(JSON.parse(dbTooling['/package.json'] ?? '{}'));

    expect(Object.keys(manifest.dependencies)).toContain('@supabase/supabase-js');
    expect(Object.keys(manifest.dependencies)).toContain('@tanstack/react-query');
    expect(Object.keys(manifest.devDependencies)).not.toContain('@supabase/supabase-js');
  });
});
