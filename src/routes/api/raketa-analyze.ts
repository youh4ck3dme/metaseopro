import { createFileRoute } from "@tanstack/react-router";
import { AnalyzeBodySchema, normalizeUrl } from "@/lib/raketa-schema";
import { AnalyzeError, runAnalysis } from "@/lib/site-analyze.server";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { assertSafePublicUrl } from "@/lib/ssrf";

const MAX_BODY_BYTES = 8 * 1024;

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/raketa-analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) return err(413, "Vstup je príliš veľký.");

          const rl = checkRateLimit(`raketa-analyze:${auth.userId}`, {
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
          if (!parsed.success) return err(400, "Neplatný vstup. Skontroluj URL a keyword.");

          const ownUrl = normalizeUrl(parsed.data.ownUrl);
          if (!ownUrl) return err(400, "Neplatná URL vlastného webu.");
          try {
            assertSafePublicUrl(ownUrl);
          } catch {
            return err(400, "URL nie je povolená (SSRF ochrana).");
          }
          const competitorUrl = parsed.data.competitorUrl
            ? normalizeUrl(parsed.data.competitorUrl)
            : "";
          if (parsed.data.competitorUrl && !competitorUrl) {
            return err(400, "Neplatná URL konkurencie.");
          }
          if (competitorUrl) {
            try {
              assertSafePublicUrl(competitorUrl);
            } catch {
              return err(400, "URL nie je povolená (SSRF ochrana).");
            }
          }

          let analysis;
          try {
            analysis = await runAnalysis(ownUrl, competitorUrl || "", parsed.data.keyword);
          } catch (e) {
            if (e instanceof AnalyzeError) {
              const status = e.code === "INVALID_URL" || e.code === "SSRF_BLOCKED" ? 400 : 502;
              return new Response(JSON.stringify({ error: e.message, code: e.code }), {
                status,
                headers: { "Content-Type": "application/json" },
              });
            }
            throw e;
          }

          return new Response(JSON.stringify({ analysis }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("raketa-analyze error:", e);
          return err(500, "Neočakávaná chyba pri analýze webu.");
        }
      },
    },
  },
});
