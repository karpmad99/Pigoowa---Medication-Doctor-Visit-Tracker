import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
// With the extension: the config file is loaded by Node itself, which needs it (src/lib/config.ts does the same).
import { readAppConfig } from './src/lib/config.ts';

export default defineConfig(({ mode }) => {
  // Refuse to build or serve with a secret key in a public variable: it would be copied into the JavaScript
  // every visitor downloads. (src/lib/config.ts does the same check when the page starts.)
  const config = readAppConfig(loadEnv(mode, process.cwd(), 'VITE_'));
  if (config.kind === 'invalid') {
    throw new Error(`Invalid Supabase configuration: ${config.problem} See .env.example.`);
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // Vitest replaces every CSS import with an empty string, including `?raw` ones. The design
      // token test needs the real text of index.css, so only that file is let through.
      css: { include: [/index\.css/] },
    },
  };
});
