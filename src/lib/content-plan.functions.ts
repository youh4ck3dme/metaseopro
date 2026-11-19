import { AI_CHAT_URL, AI_DEFAULT_MODEL } from "@/lib/ai-provider";
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { hasPaidEntitlement } from "@/lib/billing-policy";

const InputSchema = z.object({
  niche: z.string().min(2).max(500),
  goal: z.string().min(2).max(500),
  extra: z.string().max(1000).optional().default(""),
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isWithinFirstDay(firstUsedAt: string, now: number): boolean {
  const elapsed = now - Date.parse(firstUsedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MS_PER_DAY;
}

async function loadPaidAccess(supabase: SupabaseClient<Database>, userId: string, now: number) {
  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("plan, status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return hasPaidEntitlement(data, now);
  } catch {
    throw new Error("Nepodarilo sa overiť predplatné. Skúste to znova.");
  }
}

/**
 * Check whether the current user is still inside their free first-day window
 * or has a current paid entitlement. The response shape is shared with PlanPage.
 */
export const checkContentPlanAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, supabase } = context;
    const now = Date.now();
    const paidAccess = await loadPaidAccess(supabase, userId, now);
    let usage;
    try {
      const { data, error } = await supabaseAdmin
        .from("content_plan_usage")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      usage = data;
    } catch {
      throw new Error("Nepodarilo sa overiť používanie plánovača. Skúste to znova.");
    }

    if (!usage) {
      return { allowed: true, isFirstDay: true, generationsCount: 0, firstUsedAt: null };
    }
    const isFirstDay = isWithinFirstDay(usage.first_used_at, now);
    return {
      allowed: isFirstDay || paidAccess,
      isFirstDay,
      generationsCount: usage.generations_count,
      firstUsedAt: usage.first_used_at,
    };
  });

/**
 * Generate the 30-day plan with a current paid entitlement or within the free first day.
 * Returns the full markdown plan (non-streaming for simplicity & gating reliability).
 */
export const generateContentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId, supabase } = context;
    const now = Date.now();
    const paidAccess = await loadPaidAccess(supabase, userId, now);

    // UNIQUE(user_id) establishes one first-use timestamp. The later read/update
    // usage increment is not atomic and can lose increments under concurrency.
    const nowIso = new Date(now).toISOString();
    let firstUsedAt: string;
    try {
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

      if (insertErr && insertErr.code !== "23505") throw insertErr;
      if (inserted) {
        firstUsedAt = inserted.first_used_at;
      } else {
        // Existing users keep the first-use timestamp; no trial window is restarted.
        const { data: existing, error: readErr } = await supabaseAdmin
          .from("content_plan_usage")
          .select("first_used_at")
          .eq("user_id", userId)
          .maybeSingle();
        if (readErr || !existing) throw readErr ?? new Error("Usage row missing");
        firstUsedAt = existing.first_used_at;
      }
    } catch {
      throw new Error("Nepodarilo sa overiť používanie plánovača. Skúste to znova.");
    }

    if (!paidAccess && !isWithinFirstDay(firstUsedAt, now)) {
      throw new Error(
        "PAYMENT_REQUIRED: Tvoj prvý deň zdarma sa skončil. Pre ďalšie generovanie aktivuj predplatné.",
      );
    }

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error("MISTRAL_API_KEY nie je nakonfigurovaný.");

    const { CONTENT_PLAN_SYSTEM_PROMPT } = await import("./content-plan-prompt");

    const userPrompt = [
      `Niche / odvetvie: ${data.niche}`,
      `Cieľ: ${data.goal}`,
      data.extra ? `Doplňujúce informácie: ${data.extra}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    let upstream: Response;
    try {
      upstream = await fetch(AI_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_DEFAULT_MODEL,
          messages: [
            { role: "system", content: CONTENT_PLAN_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
      });
    } catch {
      throw new Error("AI poskytovateľ momentálne neodpovedá. Skúste to znova.");
    }

    if (!upstream.ok) {
      if (upstream.status === 429) throw new Error("Príliš veľa požiadaviek. Skús to o chvíľu.");
      if (upstream.status === 402) throw new Error("Vyčerpané AI kredity v workspace.");
      console.error("Content plan AI request failed", { status: upstream.status });
      throw new Error("Chyba AI gateway.");
    }

    let json: { choices?: Array<{ message?: { content?: string } }> };
    try {
      json = await upstream.json();
    } catch {
      throw new Error("AI poskytovateľ vrátil neplatnú odpoveď.");
    }
    const content = json.choices?.[0]?.message?.content ?? "";
    if (typeof content !== "string" || !content.trim())
      throw new Error("AI nevrátila žiadny obsah.");

    // Increment usage counter after successful generation.

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
