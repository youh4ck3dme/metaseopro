import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { BRIEF_SYSTEM_PROMPT } from "@/lib/brief-prompt";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";

const MAX_BODY_BYTES = 8 * 1024;

const InputSchema = z.object({
  domain: z.string().trim().max(255).optional().default(""),
  topic: z.string().trim().min(2).max(300),
  audience: z.string().trim().max(500).optional().default(""),
  language: z.string().trim().max(20).optional().default("Slovenčina (SK)"),
  competitors: z.array(z.string().trim().max(255)).max(5).optional().default([]),
  goal: z
    .enum(["traffic", "leads", "authority", "local", "sales", ""])
    .optional()
    .default(""),
});

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/generate-brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) return err(413, "Vstup je príliš veľký.");

          const rl = checkRateLimit(`brief:${auth.userId}`, {
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
          const parsed = InputSchema.safeParse(raw);
          if (!parsed.success) {
            return err(400, "Neplatný vstup. Skontroluj povinné polia.");
          }
          const input = parsed.data;

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) return err(500, "LOVABLE_API_KEY nie je nakonfigurovaný.");

          const goalLabel: Record<string, string> = {
            traffic: "Organická návštevnosť",
            leads: "Generovanie leadov",
            authority: "Budovanie autority a E-E-A-T",
            local: "Lokálne SEO",
            sales: "Predaj produktu",
            "": "Neuvedené",
          };

          const userPrompt = [
            input.domain ? `Doména / web: ${input.domain}` : "",
            `Hlavná téma / keyword: ${input.topic}`,
            input.audience ? `Cieľové publikum: ${input.audience}` : "",
            `Jazyk obsahu: ${input.language}`,
            input.competitors.length
              ? `Konkurenti: ${input.competitors.join(", ")}`
              : "",
            input.goal ? `Obchodný cieľ: ${goalLabel[input.goal]}` : "",
          ]
            .filter(Boolean)
            .join("\n");

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
                  { role: "system", content: BRIEF_SYSTEM_PROMPT },
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
          console.error("generate-brief error:", e);
          return err(500, "Neočakávaná chyba servera.");
        }
      },
    },
  },
});
