import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";

const MAX_BODY_BYTES = 8 * 1024;

const InputSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  title: z.string().trim().max(300).optional().default(""),
  queries: z.array(z.string().trim().max(200)).max(10).default([]),
  position: z.number().min(0).max(200),
  ctr: z.number().min(0).max(100),
  impressions: z.number().min(0),
});

const SYSTEM = `Si expert na CTR optimalizáciu vo výsledkoch Google pre slovenský trh.
Pre zadanú stránku vytvor presne 3 varianty v slovenčine. Pre každý variant:
### Variant N — {uhol, napr. benefit / zvedavosť / lokálne / čísla}
**Title** (max 60 znakov, primárny dopyt čo najviac vľavo): ...
**Meta description** (130–155 znakov, benefit + CTA): ...
*Prečo to zvýši CTR:* 1 veta.
Uveď počet znakov v zátvorke za každým title a popisom. Na koniec pridaj sekciu "### Odporúčanie" s výberom najlepšieho variantu a 2 tipmi (rich snippets, FAQ schema, dátum v title a pod.). Nevymýšľaj ceny ani fakty, ktoré nie sú v zadaní.`;

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/ctr-boost")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;
          if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES)
            return err(413, "Vstup je príliš veľký.");
          const rl = checkRateLimit(`ctr:${auth.userId}`, { limit: 15, windowMs: 60_000 });
          if (!rl.ok) return err(429, `Príliš veľa požiadaviek. Skús to o ${rl.retryAfterSec}s.`);

          let raw: unknown;
          try {
            raw = await request.json();
          } catch {
            return err(400, "Neplatný JSON.");
          }
          const parsed = InputSchema.safeParse(raw);
          if (!parsed.success) return err(400, "Neplatný vstup.");
          const i = parsed.data;

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) return err(500, "AI nie je nakonfigurované.");

          const userPrompt = [
            `URL: ${i.url}`,
            i.title ? `Aktuálny názov: ${i.title}` : "",
            `Hlavné dopyty: ${i.queries.join(", ") || "neuvedené"}`,
            `Priemerná pozícia: ${i.position.toFixed(1)}`,
            `Impresie (90 dní): ${Math.round(i.impressions)}`,
            `Aktuálny CTR: ${i.ctr.toFixed(2)} %`,
          ]
            .filter(Boolean)
            .join("\n");

          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "openai/gpt-6-astra",
              instructions: SYSTEM,
              input: userPrompt,
            }),
          });
          if (!upstream.ok) {
            if (upstream.status === 429) return err(429, "AI je preťažené. Skús to o chvíľu.");
            if (upstream.status === 402) return err(402, "Vyčerpané AI kredity vo workspace.");
            console.error("ctr-boost AI error", upstream.status, await upstream.text());
            return err(500, "Chyba AI.");
          }
          const json = (await upstream.json()) as {
            output?: { type?: string; content?: { type?: string; text?: string }[] }[];
          };
          const text = (json.output ?? [])
            .flatMap((o) => o.content ?? [])
            .filter((c) => c.type === "output_text")
            .map((c) => c.text ?? "")
            .join("");
          // Re-emit as a single chat-style SSE chunk so the shared client stream reader works.
          const sse =
            `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
            "data: [DONE]\n\n";
          return new Response(sse, {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          });
        } catch (e) {
          console.error("ctr-boost error:", e);
          return err(500, "Neočakávaná chyba servera.");
        }
      },
    },
  },
});
