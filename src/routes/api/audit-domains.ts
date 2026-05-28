import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AUDIT_SYSTEM_PROMPT } from "@/lib/audit-prompt";
import {
  getDomainSnapshot,
  SemrushError,
  type DomainSnapshot,
} from "@/lib/semrush.server";
import { requireUser } from "@/lib/api-auth.server";
import { checkRateLimit } from "@/lib/rate-limit.server";

const MAX_BODY_BYTES = 8 * 1024;

const DOMAIN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const ALLOWED_DBS = ["", "sk", "cz", "us", "uk", "de", "pl", "hu", "fr", "es", "it", "at"] as const;

const InputSchema = z.object({
  domains: z.array(z.string().min(1).max(255)).min(1).max(5),
  database: z.enum(ALLOWED_DBS).optional().default(""),
  yourDomain: z.string().trim().max(255).optional().default(""),
});

function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split("/")[0].split("?")[0];
  if (d.length > 253) return null;
  if (!DOMAIN_RE.test(d)) return null;
  return d;
}

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/audit-domains")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) return err(413, "Vstup je príliš veľký.");

          const rl = checkRateLimit(`audit:${auth.userId}`, {
            limit: 6,
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
          if (!parsed.success) return err(400, "Zadaj 1 až 5 domén.");

          const normalized: string[] = [];
          for (const d of parsed.data.domains) {
            const n = normalizeDomain(d);
            if (!n) return err(400, `Neplatná doména: "${d}". Použi formát napr. priklad.sk`);
            normalized.push(n);
          }
          const yourDomain = parsed.data.yourDomain
            ? normalizeDomain(parsed.data.yourDomain)
            : null;

          if (!process.env.SEMRUSH_API_KEY) {
            return err(
              503,
              "Semrush konektor nie je pripojený. Pripoj ho v nastaveniach projektu.",
            );
          }

          let snapshots: DomainSnapshot[];
          try {
            snapshots = await Promise.all(
              normalized.map((d) => getDomainSnapshot(d, parsed.data.database || undefined)),
            );
          } catch (e) {
            if (e instanceof SemrushError) {
              return err(
                e.status >= 400 && e.status < 600 ? e.status : 500,
                e.message,
              );
            }
            throw e;
          }

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) return err(500, "LOVABLE_API_KEY nie je nakonfigurovaný.");

          const userPrompt =
            `Analyzuj nasledujúce domény podľa systémového promptu. ` +
            (yourDomain
              ? `\n\n**TVOJA DOMÉNA:** ${yourDomain} — zameraj odporúčania na to, ako môže predbehnúť ostatné.\n`
              : "\n") +
            `\nDomény: ${normalized.join(", ")}\n` +
            `Semrush database: ${parsed.data.database || "auto-detekcia podľa TLD"}\n\n` +
            `Reálne dáta (JSON):\n\`\`\`json\n${JSON.stringify(snapshots, null, 2)}\n\`\`\``;

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
                  { role: "system", content: AUDIT_SYSTEM_PROMPT },
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
          console.error("audit-domains error:", e);
          return err(500, "Neočakávaná chyba servera.");
        }
      },
    },
  },
});
