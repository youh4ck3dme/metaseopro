import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  RAKETA_LANGUAGES,
  RAKETA_OUTPUTS,
  type RaketaAnalysis,
} from "@/lib/raketa-schema";
import { RAKETA_SYSTEM_PROMPT, buildRaketaUserPrompt } from "@/lib/raketa-prompt";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";

const MAX_BODY_BYTES = 48 * 1024;

const PageSchema = z.object({
  url: z.string().max(2048),
  ok: z.boolean(),
  estimated: z.boolean(),
  title: z.string().max(2000),
  metaDescription: z.string().max(2000),
  h1: z.array(z.string().max(500)).max(20),
  h2: z.array(z.string().max(500)).max(40),
  h3: z.array(z.string().max(500)).max(60),
  ctas: z.array(z.string().max(200)).max(20),
  wordCount: z.number().int().min(0).max(10_000_000),
  textSummary: z.string().max(4000),
  note: z.string().max(500).optional(),
});

const InputSchema = z.object({
  keyword: z.string().trim().min(2).max(200),
  language: z.enum(RAKETA_LANGUAGES),
  output: z.enum(RAKETA_OUTPUTS),
  analysis: z.object({
    own: PageSchema,
    competitor: PageSchema.nullable(),
    comparison: z.object({
      contentGaps: z.array(z.string().max(500)).max(40),
      missingKeywords: z.array(z.string().max(500)).max(40),
      weakHeadings: z.array(z.string().max(500)).max(40),
      metaIssues: z.array(z.string().max(500)).max(40),
      ctaIssues: z.array(z.string().max(500)).max(40),
    }),
  }),
});

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/raketa-generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) return err(413, "Vstup je príliš veľký.");

          const rl = checkRateLimit(`raketa-generate:${auth.userId}`, {
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
          const parsed = InputSchema.safeParse(raw);
          if (!parsed.success) return err(400, "Neplatný vstup pre generovanie.");

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) return err(500, "LOVABLE_API_KEY nie je nakonfigurovaný.");

          const userPrompt = buildRaketaUserPrompt({
            keyword: parsed.data.keyword,
            language: parsed.data.language,
            output: parsed.data.output,
            analysis: parsed.data.analysis as RaketaAnalysis,
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
                  { role: "system", content: RAKETA_SYSTEM_PROMPT },
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
          console.error("raketa-generate error:", e);
          return err(500, "Neočakávaná chyba servera.");
        }
      },
    },
  },
});
