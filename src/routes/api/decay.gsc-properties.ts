import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { listSites } from "@/lib/gsc.server";

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/decay/gsc-properties")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const rl = checkRateLimit(`decay-properties:${auth.userId}`, {
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

          const { status, sites } = await listSites();
          return new Response(JSON.stringify({ status, sites }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("decay gsc-properties error:", e);
          return err(500, "Neočakávaná chyba pri načítaní GSC properties.");
        }
      },
    },
  },
});
