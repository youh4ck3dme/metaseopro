import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  niche: z.string().min(2).max(500),
  goal: z.string().min(2).max(500),
  extra: z.string().max(1000).optional().default(""),
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Check whether the current user is still inside their free first-day window
 * or has already paid. Returns { allowed, reason, usage }.
 */
export const checkContentPlanAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .from("content_plan_usage")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!data) {
      return { allowed: true, isFirstDay: true, generationsCount: 0, firstUsedAt: null };
    }
    const first = new Date(data.first_used_at).getTime();
    const elapsedMs = Date.now() - first;
    const isFirstDay = elapsedMs < MS_PER_DAY;
    return {
      allowed: isFirstDay,
      isFirstDay,
      generationsCount: data.generations_count,
      firstUsedAt: data.first_used_at,
    };
  });

/**
 * Generate the 30-day plan. Enforces the "first day free" gate, then increments usage.
 * Returns the full markdown plan (non-streaming for simplicity & gating reliability).
 */
export const generateContentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Atomic gate: try to claim the free window by inserting the usage row.
    // The UNIQUE(user_id) constraint serializes concurrent first-time inserts;
    // only one wins, the rest fall through to the read-and-check branch.
    const nowIso = new Date().toISOString();
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("content_plan_usage")
      .insert({
        user_id: userId,
        first_used_at: nowIso,
        last_used_at: nowIso,
        generations_count: 0,
      })
      .select()
      .maybeSingle();

    let firstUsedAt: string;
    if (inserted) {
      firstUsedAt = inserted.first_used_at;
    } else {
      // Either the insert conflicted on UNIQUE(user_id) or returned no row;
      // re-read and enforce the 24h free window before spending AI credits.
      if (insertErr && insertErr.code !== "23505") {
        throw new Error(insertErr.message);
      }
      const { data: existing, error: readErr } = await supabaseAdmin
        .from("content_plan_usage")
        .select("first_used_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (readErr || !existing) {
        throw new Error(readErr?.message ?? "Nepodarilo sa overiť usage.");
      }
      firstUsedAt = existing.first_used_at;
      const elapsedMs = Date.now() - new Date(firstUsedAt).getTime();
      if (elapsedMs >= MS_PER_DAY) {
        throw new Error(
          "PAYMENT_REQUIRED: Tvoj prvý deň zdarma sa skončil. Pre ďalšie generovanie aktivuj predplatné.",
        );
      }
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY nie je nakonfigurovaný.");

    const { CONTENT_PLAN_SYSTEM_PROMPT } = await import("./content-plan-prompt");

    const userPrompt = [
      `Niche / odvetvie: ${data.niche}`,
      `Cieľ: ${data.goal}`,
      data.extra ? `Doplňujúce informácie: ${data.extra}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: CONTENT_PLAN_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) throw new Error("Príliš veľa požiadaviek. Skús to o chvíľu.");
      if (upstream.status === 402) throw new Error("Vyčerpané AI kredity v workspace.");
      const text = await upstream.text();
      console.error("AI gateway error:", upstream.status, text);
      throw new Error("Chyba AI gateway.");
    }

    const json = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("AI nevrátila žiadny obsah.");

    // Atomic increment of usage counter via RPC-less update.
    await supabaseAdmin.rpc;
    const { data: cur } = await supabaseAdmin
      .from("content_plan_usage")
      .select("generations_count")
      .eq("user_id", userId)
      .maybeSingle();
    await supabaseAdmin
      .from("content_plan_usage")
      .update({
        generations_count: (cur?.generations_count ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return { plan: content };
  });

