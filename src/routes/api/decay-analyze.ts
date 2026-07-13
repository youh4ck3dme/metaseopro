import { createFileRoute } from "@tanstack/react-router";
import { AnalyzeDecaySchema } from "@/lib/decay-schema";
import { runDecayAnalysis } from "@/lib/decay-analyze.server";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";

const MAX_BODY_BYTES = 8 * 1024;

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/decay-analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) return err(413, "Vstup je príliš veľký.");

          const rl = checkRateLimit(`decay-analyze:${auth.userId}`, {
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

          let raw: unknown;
          try {
            raw = await request.json();
          } catch {
            return err(400, "Neplatný JSON.");
          }
          const parsed = AnalyzeDecaySchema.safeParse(raw);
          if (!parsed.success) return err(400, "Neplatný vstup. Vyber demo scenár.");

          const dataset = await runDecayAnalysis(parsed.data.scenario);
          return new Response(JSON.stringify({ dataset }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("decay-analyze error:", e);
          return err(500, "Neočakávaná chyba pri analýze.");
        }
      },
    },
  },
});
