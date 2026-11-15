/**
 * Server-only Supabase env resolution with VITE_* fallback.
 *
 * Some deployments (e.g. Vercel) expose only VITE_SUPABASE_* variables, while
 * others expose SUPABASE_*. Server code must work with either. Values are
 * trimmed; empty/whitespace strings count as missing. When the URL or the
 * publishable key is missing/invalid, a descriptive error is thrown WITHOUT
 * ever including the values (fail-closed — callers return 401/500, never data).
 *
 * Never use or add service_role / sb_secret keys here.
 */

function readFirstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getServerSupabaseUrl(): string {
  const url = readFirstEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  if (!url) {
    throw new Error(
      "Supabase URL nie je nakonfigurovaná (chýba SUPABASE_URL aj VITE_SUPABASE_URL).",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Supabase URL má neplatný formát.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Supabase URL musí používať protokol https.");
  }
  if (!parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("Supabase URL musí smerovať na host *.supabase.co.");
  }
  return url;
}

export function getServerSupabasePublishableKey(): string {
  const key = readFirstEnv(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  if (!key) {
    throw new Error(
      "Supabase publishable key nie je nakonfigurovaný (chýba SUPABASE_PUBLISHABLE_KEY aj VITE_SUPABASE_PUBLISHABLE_KEY).",
    );
  }
  return key;
}
