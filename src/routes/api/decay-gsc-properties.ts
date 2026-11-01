import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { isGscConfigured, listVerifiedProperties } from "@/lib/gsc.server";

export const Route = createFileRoute("/api/decay-gsc-properties")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (!auth.ok) return auth.response;

        const rl = checkRateLimit(`decay-gsc:${auth.userId}`, {
          limit: 20,
          windowMs: 60_000,
        });
        if (!rl.ok) {
          return new Response(
            JSON.stringify({
              error: `Príliš veľa požiadaviek. Skús to o ${rl.retryAfterSec}s.`,
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": String(rl.retryAfterSec),
              },
            },
          );
        }

        if (!isGscConfigured()) {
          return new Response(
            JSON.stringify({ status: "not_connected", properties: [] }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          const properties = await listVerifiedProperties();
          return new Response(JSON.stringify({ status: "ok", properties }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("decay-gsc-properties error:", e);
          return new Response(
            JSON.stringify({
              status: "error",
              properties: [],
              error:
                "Nepodarilo sa načítať Search Console properties. Skús to znova alebo použi demo režim.",
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
