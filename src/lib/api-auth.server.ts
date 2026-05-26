// Server-only helper for verifying Supabase JWTs in raw HTTP route handlers.
import { createClient } from "@supabase/supabase-js";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

function unauthorized(message = "Vyžaduje sa prihlásenie."): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function requireUser(request: Request): Promise<AuthResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Server nie je správne nakonfigurovaný." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
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
  return { ok: true, userId: String(data.claims.sub) };
}
