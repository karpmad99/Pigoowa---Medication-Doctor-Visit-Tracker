import { describe, expect, it } from 'vitest';

// Rules about WHERE code may live, checked on the source text so they cannot erode unnoticed.

const files = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const productionSources = Object.entries(files).filter(
  ([path]) => !/\.test\.tsx?$/.test(path) && !path.startsWith('/src/test/'),
);

// The rules are about code, so comments (which may mention localStorage or console in prose) are removed first.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

function pathsWhere(matches: (path: string, source: string) => boolean): string[] {
  return productionSources
    .filter(([path, source]) => matches(path, withoutComments(source)))
    .map(([path]) => path);
}

describe('architecture rules', () => {
  it('finds the source files (guards against a broken glob making every rule pass)', () => {
    expect(productionSources.length).toBeGreaterThan(40);
    expect(productionSources.some(([path]) => path === '/src/services/local/storage.ts')).toBe(
      true,
    );
  });

  it('reads and writes browser storage only inside the storage adapter', () => {
    const usage = /\b(?:window\.|globalThis\.)?(?:localStorage|sessionStorage)\s*[.[]/;

    expect(pathsWhere((_path, source) => usage.test(source))).toEqual([
      '/src/services/local/storage.ts',
    ]);
  });

  it('keeps the browser-storage implementation out of components, pages, hooks and features', () => {
    const layers = /^\/src\/(components|pages|hooks|features|app)\//;

    expect(
      pathsWhere((path, source) => layers.test(path) && source.includes("'@/services/local")),
    ).toEqual([]);
  });

  it('never logs to the console, so health data cannot leak into logs', () => {
    expect(pathsWhere((_path, source) => /\bconsole\s*\./.test(source))).toEqual([]);
  });

  it('keeps business logic and utilities free of React and of the services layer', () => {
    const pure = /^\/src\/(utils|types)\/|\/logic\//;

    expect(
      pathsWhere(
        (path, source) =>
          pure.test(path) && /from '(react|react-dom|react-router|@\/services)/.test(source),
      ),
    ).toEqual([]);
  });

  it('keeps the services layer free of React', () => {
    expect(
      pathsWhere(
        (path, source) =>
          path.startsWith('/src/services/') && /from '(react|react-dom|react-router)/.test(source),
      ),
    ).toEqual([]);
  });
});
