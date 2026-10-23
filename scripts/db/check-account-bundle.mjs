// Builds the application WITH the two public variables (as the local stack gives them) into a temporary
// folder and checks what a visitor would download: the only key in it is the PUBLIC one.
//
// Every JWT-shaped string in the scripts is decoded and must have the role "anon"; no "sb_secret_" token may
// be there; and the public key must be there (so the check cannot pass by finding nothing). The secret keys
// of the stack are neither read nor needed: the check works on what is in the bundle.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required (npm run check:account-bundle).',
  );
  process.exit(2);
}

const outDir = mkdtempSync(join(tmpdir(), 'pigoowa-account-bundle-'));
try {
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: process.env,
  });

  const assets = join(outDir, 'assets');
  const scripts = readdirSync(assets).filter((name) => name.endsWith('.js'));
  const problems = [];
  let publicKeyFound = false;
  for (const name of scripts) {
    const text = readFileSync(join(assets, name), 'utf8');
    if (text.includes(key)) publicKeyFound = true;
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) problems.push(`${name}: a sb_secret_ token`);
    if (/postgres(ql)?:\/\/\w+:\w+@/.test(text))
      problems.push(`${name}: a database URL with a password`);
    for (const match of text.matchAll(
      /eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g,
    )) {
      let role = 'unreadable';
      try {
        role = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')).role ?? 'none';
      } catch {
        // stays "unreadable"
      }
      if (role !== 'anon') problems.push(`${name}: a JWT with the role "${role}"`);
    }
  }
  if (!publicKeyFound)
    problems.push('the public key is not in the bundle: the check proves nothing');

  if (problems.length > 0) {
    console.error(`account bundle check FAILED:\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `account bundle check passed: ${scripts.length} scripts, the only key is the public one.`,
    );
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
