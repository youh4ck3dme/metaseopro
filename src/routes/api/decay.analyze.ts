import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { AnalyzeBodySchema, normalizePropertyToUrl } from "@/lib/decay-schema";
import { runLiveAnalysis } from "@/lib/decay-analyze.server";
import { buildDemoAnalysis } from "@/lib/decay-demo";

const MAX_BODY_BYTES = 8 * 1024;

function err(status: number, message: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/decay/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) return err(413, "Vstup je príliš veľký.");

          const rl = checkRateLimit(`decay-analyze:${auth.userId}`, {
            limit: 10,
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
          const parsed = AnalyzeBodySchema.safeParse(raw);
          if (!parsed.success) return err(400, "Neplatný vstup pre analýzu.");
          const body = parsed.data;

          if (body.mode === "demo") {
            const result = buildDemoAnalysis(
              body.demoScenario,
              body.window,
              body.minImpressions,
              body.urlContains,
            );
            return new Response(JSON.stringify({ result }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          // live mode
          if (!body.property) {
            return err(400, "Vyber GSC property pre live analýzu.");
          }
          const property = normalizePropertyToUrl(body.property)
            ? body.property
            : body.property;

          const out = await runLiveAnalysis({
            property,
            window: body.window,
            minImpressions: body.minImpressions,
            urlContains: body.urlContains,
            includeQueryLevel: body.includeQueryLevel,
          });

          if (!out.ok) {
            const status =
              out.status === "not_connected" || out.status === "reconnect"
                ? 409
                : out.status === "permission_error"
                  ? 403
                  : 502;
            return err(status, out.message, { gscStatus: out.status });
          }

          return new Response(JSON.stringify({ result: out.result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("decay analyze error:", e);
          return err(500, "Neočakávaná chyba pri analýze.");
        }
      },
    },
  },
});
