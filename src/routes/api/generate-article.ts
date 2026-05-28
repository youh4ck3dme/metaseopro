import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ARTICLE_SYSTEM_PROMPT } from "@/lib/article-prompt";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";

const MAX_BODY_BYTES = 16 * 1024;

const InputSchema = z.object({
  topic: z.string().trim().min(5).max(4000),
  primaryKeyword: z.string().trim().max(150).optional().default(""),
  audience: z.string().trim().max(300).optional().default(""),
  tone: z.enum(["", "friendly", "expert", "sales"]).optional().default(""),
  targetLength: z.enum(["", "1500", "2000", "2800"]).optional().default(""),
});

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TONE_LABEL: Record<string, string> = {
  friendly: "priateľský, motivujúci",
  expert: "expertný, autoritatívny, podložený dátami",
  sales: "predajný, zameraný na konverziu a benefity",
};

export const Route = createFileRoute("/api/generate-article")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) return err(413, "Vstup je príliš veľký.");

          const rl = checkRateLimit(`article:${auth.userId}`, {
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
          if (!parsed.success) {
            return err(400, "Zadaj aspoň pár viet o téme.");
          }
          const { topic, primaryKeyword, audience, tone, targetLength } = parsed.data;

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) return err(500, "LOVABLE_API_KEY nie je nakonfigurovaný.");

          const userPrompt = [
            `Téma a kontext:\n${topic}`,
            primaryKeyword ? `Primárne keyword: ${primaryKeyword}` : "",
            audience ? `Cieľové publikum: ${audience}` : "",
            tone ? `Tón hlasu: ${TONE_LABEL[tone] ?? tone}` : "",
            targetLength ? `Cieľová dĺžka: ~${targetLength} slov` : "",
          ]
            .filter(Boolean)
            .join("\n\n");

          const upstream = await fetch(
            "https://ai.gateway.lovable.dev/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                stream: true,
                messages: [
                  { role: "system", content: ARTICLE_SYSTEM_PROMPT },
                  { role: "user", content: userPrompt },
                ],
              }),
            },
          );

          if (!upstream.ok || !upstream.body) {
            if (upstream.status === 429) return err(429, "Príliš veľa požiadaviek. Skús to o chvíľu.");
            if (upstream.status === 402) return err(402, "Vyčerpané AI kredity.");
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
          console.error("generate-article error:", e);
          return err(500, "Neočakávaná chyba servera.");
        }
      },
    },
  },
});
