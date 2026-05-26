import { createFileRoute } from "@tanstack/react-router";
import { ARTICLE_SYSTEM_PROMPT } from "@/lib/article-prompt";
import { requireUser } from "@/lib/api-auth.server";

const MAX_BODY_BYTES = 16 * 1024; // 16 KB


export const Route = createFileRoute("/api/generate-article")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { topic } = (await request.json()) as { topic?: string };
          if (!topic || typeof topic !== "string" || topic.trim().length < 5) {
            return new Response(
              JSON.stringify({ error: "Zadaj aspoň pár viet o téme." }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          if (topic.length > 2000) {
            return new Response(
              JSON.stringify({ error: "Vstup je príliš dlhý (max 2000 znakov)." }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(
              JSON.stringify({ error: "LOVABLE_API_KEY nie je nakonfigurovaný." }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

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
                  { role: "user", content: topic.trim() },
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
                { status: 429, headers: { "Content-Type": "application/json" } },
              );
            }
            if (upstream.status === 402) {
              return new Response(
                JSON.stringify({
                  error:
                    "Vyčerpané kredity. Pridaj kredity v Lovable workspace nastaveniach.",
                }),
                { status: 402, headers: { "Content-Type": "application/json" } },
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
          console.error("generate-article error:", e);
          return new Response(
            JSON.stringify({ error: "Neočakávaná chyba servera." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
