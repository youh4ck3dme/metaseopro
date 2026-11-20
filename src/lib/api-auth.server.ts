// Server-only helper for verifying Supabase JWTs in raw HTTP route handlers.
import { createClient } from "@supabase/supabase-js";
import { getServerSupabasePublishableKey, getServerSupabaseUrl } from "./supabase-env.server";

export type AuthResult =
  { ok: true; userId: string; email?: string } | { ok: false; response: Response };

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
  // getClaims can throw (not just return `error`) on malformed, JWT-shaped tokens.
  // Fail closed: any exception means "not authenticated" -> 401, never a 500.
  // Log only a static message; the error detail may contain token material.
  let claimsResult: Awaited<ReturnType<typeof supabase.auth.getClaims>>;
  try {
    claimsResult = await supabase.auth.getClaims(token);
  } catch {
    console.warn("[api-auth] token verification threw; responding 401");
    return { ok: false, response: unauthorized() };
  }
  const { data, error } = claimsResult;
  if (error || !data?.claims?.sub) {
    return { ok: false, response: unauthorized() };
  }
  return {
    ok: true,
    userId: String(data.claims.sub),
    email: typeof data.claims.email === "string" ? data.claims.email : undefined,
  };
}
