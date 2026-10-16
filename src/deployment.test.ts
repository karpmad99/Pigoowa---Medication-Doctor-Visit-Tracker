import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// The demo is a static site (ROADMAP stage 9): this checks the hosting configuration that cannot be
// exercised by the app itself, so a careless edit cannot break deep links or add a backend.

const rawFiles = import.meta.glob<string>(['/vercel.json', '/index.html'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const headerSchema = z.object({ key: z.string(), value: z.string() });
const vercelSchema = z.object({
  framework: z.literal('vite'),
  outputDirectory: z.literal('dist'),
  rewrites: z.array(z.object({ source: z.string(), destination: z.string() })),
  headers: z.array(z.object({ source: z.string(), headers: z.array(headerSchema) })),
});

function readVercelConfig() {
  const source = rawFiles['/vercel.json'];
  if (source === undefined) throw new Error('vercel.json is missing');
  return vercelSchema.parse(JSON.parse(source));
}

describe('demo deployment configuration', () => {
  it('rewrites every path that is not a file to the single-page app (deep links and reload)', () => {
    const { rewrites } = readVercelConfig();

    expect(rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  it('does not proxy anything: no rewrite, redirect or header points at another host', () => {
    const settings = z.looseObject({}).parse(JSON.parse(rawFiles['/vercel.json'] ?? '{}'));
    const { $schema, ...withoutEditorHint } = settings;

    expect($schema).toEqual(expect.any(String));
    expect(JSON.stringify(withoutEditorHint)).not.toMatch(/https?:\/\//);
    for (const backendSetting of ['redirects', 'env', 'functions', 'crons']) {
      expect(settings).not.toHaveProperty(backendSetting);
    }
  });

  it('sends the basic hardening headers on every page', () => {
    const { headers } = readVercelConfig();
    const everywhere = headers.find((entry) => entry.source === '/(.*)');

    expect(everywhere?.headers).toEqual(
      expect.arrayContaining([
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ]),
    );
  });

  it('loads nothing from other hosts in index.html', () => {
    const html = rawFiles['/index.html'] ?? '';

    expect(html).toContain('<div id="root">');
    expect(html).not.toMatch(/(?:src|href)="https?:\/\//);
  });
});
