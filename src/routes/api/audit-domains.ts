import { createFileRoute } from "@tanstack/react-router";
import { AUDIT_SYSTEM_PROMPT } from "@/lib/audit-prompt";
import {
  getDomainSnapshot,
  SemrushError,
  type DomainSnapshot,
} from "@/lib/semrush.server";
import { requireUser } from "@/lib/api-auth.server";

const MAX_BODY_BYTES = 8 * 1024; // 8 KB


const DOMAIN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split("/")[0].split("?")[0];
  if (d.length > 253) return null;
  if (!DOMAIN_RE.test(d)) return null;
  return d;
}

export const Route = createFileRoute("/api/audit-domains")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (!auth.ok) return auth.response;

          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY_BYTES) {
            return new Response(
              JSON.stringify({ error: "Vstup je príliš veľký." }),
              { status: 413, headers: { "Content-Type": "application/json" } },
            );
          }
          const { domains } = (await request.json()) as { domains?: unknown };

          if (!Array.isArray(domains) || domains.length === 0) {
            return new Response(
              JSON.stringify({ error: "Zadaj 1 až 5 domén." }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          if (domains.length > 5) {
            return new Response(
              JSON.stringify({ error: "Maximálne 5 domén naraz." }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const normalized: string[] = [];
          for (const raw of domains) {
            if (typeof raw !== "string") {
              return new Response(
                JSON.stringify({ error: "Neplatný formát domény." }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            const n = normalizeDomain(raw);
            if (!n) {
              return new Response(
                JSON.stringify({
                  error: `Neplatná doména: "${raw}". Použi formát napr. priklad.sk`,
                }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            normalized.push(n);
          }

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(
              JSON.stringify({
                error: "LOVABLE_API_KEY nie je nakonfigurovaný.",
              }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          if (!process.env.SEMRUSH_API_KEY) {
            return new Response(
              JSON.stringify({
                error:
                  "Semrush konektor nie je pripojený. Pripoj ho v nastaveniach projektu.",
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }

          // Fetch Semrush data for all domains in parallel.
          let snapshots: DomainSnapshot[];
          try {
            snapshots = await Promise.all(
              normalized.map((d) => getDomainSnapshot(d)),
            );
          } catch (e) {
            if (e instanceof SemrushError) {
              return new Response(JSON.stringify({ error: e.message }), {
                status: e.status >= 400 && e.status < 600 ? e.status : 500,
                headers: { "Content-Type": "application/json" },
              });
            }
            throw e;
          }

          const userPrompt =
            `Analyzuj nasledujúce domény na základe týchto reálnych dát zo Semrush. ` +
            `Postupuj presne podľa formátu, ktorý máš v systémovom prompte.\n\n` +
            `Domény: ${normalized.join(", ")}\n\n` +
            `Dáta (JSON):\n\`\`\`json\n${JSON.stringify(snapshots, null, 2)}\n\`\`\``;

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
                  { role: "system", content: AUDIT_SYSTEM_PROMPT },
                  { role: "user", content: userPrompt },
                ],
              }),
            },
          );

          if (!upstream.ok || !upstream.body) {
            if (upstream.status === 429) {
              return new Response(
                JSON.stringify({
                  error: "Príliš veľa požiadaviek. Skús to o chvíľu znovu.",
                }),
                {
                  status: 429,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            if (upstream.status === 402) {
              return new Response(
                JSON.stringify({
                  error:
                    "Vyčerpané kredity. Pridaj kredity v Lovable workspace nastaveniach.",
                }),
                {
                  status: 402,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            const text = await upstream.text();
            console.error("AI gateway error:", upstream.status, text);
            return new Response(
              JSON.stringify({ error: "Chyba AI gateway." }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          return new Response(upstream.body, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
        } catch (e) {
          console.error("audit-domains error:", e);
          return new Response(
            JSON.stringify({ error: "Neočakávaná chyba servera." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
