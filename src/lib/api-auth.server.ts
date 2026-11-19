// Server-only helper for verifying Supabase JWTs in raw HTTP route handlers.
import { createClient } from "@supabase/supabase-js";
import { getServerSupabasePublishableKey, getServerSupabaseUrl } from "./supabase-env.server";

export type AuthResult =
  | {
      ok: true;
      userId: string;
      email?: string;
      emailConfirmedAt?: string | null;
      emailVerified?: boolean;
    }
  | { ok: false; response: Response };

function unauthorized(message = "Vyžaduje sa prihlásenie."): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function requireUser(request: Request): Promise<AuthResult> {
  const url = getServerSupabaseUrl();
  const key = getServerSupabasePublishableKey();
  if (!url || !key) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Server nie je správne nakonfigurovaný." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, response: unauthorized() };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false, response: unauthorized() };

  const supabase = createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return { ok: false, response: unauthorized() };
  }
  const claims = data.claims as Record<string, unknown>;
  return {
    ok: true,
    userId: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : undefined,
    emailConfirmedAt:
      typeof claims.email_confirmed_at === "string" ? claims.email_confirmed_at : null,
    emailVerified: claims.email_verified === true,
  };
}
