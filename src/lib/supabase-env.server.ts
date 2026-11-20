// Server-only: resolves the public Supabase connection settings.
//
// Tracked `.env` carries only the 3 public VITE_SUPABASE_* keys. Lookup order:
//   1. process.env.SUPABASE_*       (explicit server runtime variable)
//   2. process.env.VITE_SUPABASE_*  (runtime variable on the target)
//   3. import.meta.env.VITE_SUPABASE_* (build-time value inlined from `.env`;
//      public values only, never a secret)
// Empty / whitespace-only strings count as "not set" and the returned value is
// trimmed. Callers must keep failing closed when this returns undefined.

function pick(...candidates: Array<string | undefined>): string | undefined {
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

// `import.meta.env.VITE_*` is referenced literally (inside the functions) so the
// bundler can inline it at build time.
export function getServerSupabaseUrl(): string | undefined {
  return pick(
    process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_URL,
  );
}

export function getServerSupabasePublishableKey(): string | undefined {
  return pick(
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
}
