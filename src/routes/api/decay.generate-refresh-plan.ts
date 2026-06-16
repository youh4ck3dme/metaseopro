import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { GeneratePlanBodySchema } from "@/lib/decay-schema";
import { DECAY_SYSTEM_PROMPT, buildDecayUserPrompt } from "@/lib/decay-prompt";

const MAX_BODY_BYTES = 24 * 1024;

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/decay/generate-refresh-plan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) return err(413, "Vstup je príliš veľký.");

          const rl = checkRateLimit(`decay-generate:${auth.userId}`, {
            limit: 8,
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
          const parsed = GeneratePlanBodySchema.safeParse(raw);
          if (!parsed.success) return err(400, "Neplatný vstup pre generovanie.");

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) return err(500, "LOVABLE_API_KEY nie je nakonfigurovaný.");

          const userPrompt = buildDecayUserPrompt({
            row: parsed.data.row,
            language: parsed.data.language,
            mode: parsed.data.mode,
            property: parsed.data.property || "(neuvedené)",
            window: parsed.data.window,
          });

          const upstream = await fetch(
            "https://ai.gateway.lovable.dev/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-pro",
                stream: true,
                messages: [
                  { role: "system", content: DECAY_SYSTEM_PROMPT },
                  { role: "user", content: userPrompt },
                ],
              }),
            },
          );

          if (!upstream.ok || !upstream.body) {
            if (upstream.status === 429)
              return err(429, "AI gateway je preťažený. Skús to o chvíľu.");
            if (upstream.status === 402)
              return err(402, "Vyčerpané AI kredity v workspace.");
            const text = await upstream.text();
            console.error("AI gateway error:", upstream.status, text);
            return err(500, "Chyba AI gateway.");
          }

          return new Response(upstream.body, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
        } catch (e) {
          console.error("decay generate error:", e);
          return err(500, "Neočakávaná chyba servera.");
        }
      },
    },
  },
});
