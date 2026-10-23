import { describe, expect, it } from 'vitest';
import { readAppConfig } from './config';

const KEY = 'sb_publishable_abcdefghijklmnop';

describe('readAppConfig', () => {
  it('is the demonstration version when nothing is configured', () => {
    expect(readAppConfig({})).toEqual({ kind: 'demo-only' });
    expect(readAppConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '  ' })).toEqual({
      kind: 'demo-only',
    });
  });

  it('is accounts when both variables are set', () => {
    expect(
      readAppConfig({
        VITE_SUPABASE_URL: 'https://abc.supabase.example/',
        VITE_SUPABASE_ANON_KEY: KEY,
      }),
    ).toEqual({
      kind: 'accounts',
      supabaseUrl: 'https://abc.supabase.example',
      supabaseAnonKey: KEY,
    });
  });

  it('accepts plain http only for a local server', () => {
    expect(
      readAppConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: KEY }),
    ).toMatchObject({ kind: 'accounts', supabaseUrl: 'http://127.0.0.1:54321' });
    expect(
      readAppConfig({ VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: KEY }),
    ).toMatchObject({ kind: 'accounts' });
    expect(
      readAppConfig({ VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_ANON_KEY: KEY }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('reports one variable without the other instead of guessing', () => {
    expect(readAppConfig({ VITE_SUPABASE_URL: 'https://abc.example' })).toMatchObject({
      kind: 'invalid',
      problem: expect.stringContaining('VITE_SUPABASE_ANON_KEY') as unknown,
    });
    expect(readAppConfig({ VITE_SUPABASE_ANON_KEY: KEY })).toMatchObject({
      kind: 'invalid',
      problem: expect.stringContaining('VITE_SUPABASE_URL') as unknown,
    });
  });

  it('refuses a URL that is not one', () => {
    expect(
      readAppConfig({ VITE_SUPABASE_URL: 'nonsense', VITE_SUPABASE_ANON_KEY: KEY }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('refuses a secret key in the browser build, without printing it', () => {
    const secret = 'sb_secret_DO_NOT_SHOW_THIS_ONE';

    const config = readAppConfig({
      VITE_SUPABASE_URL: 'https://abc.example',
      VITE_SUPABASE_ANON_KEY: secret,
    });

    expect(config.kind).toBe('invalid');
    expect(JSON.stringify(config)).not.toContain('DO_NOT_SHOW_THIS_ONE');
  });
});
