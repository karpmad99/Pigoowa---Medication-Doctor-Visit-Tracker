// The two public variables of the build with accounts (.env.example, src/lib/config.ts). Both are optional:
// without them the build is the public demonstration.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
