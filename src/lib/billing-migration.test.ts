import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real PostgreSQL in WASM: SQL/constraints/RLS/lease interleavings, not a hosted Supabase test.
const user1 = "11111111-1111-4111-8111-111111111111";
const user2 = "22222222-2222-4222-8222-222222222222";
const request1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const hash1 = "a".repeat(64);
let db: PGlite;
type Claim = {
  status: string;
  userId: string;
  customerId: string;
  livemode: boolean;
  leaseToken: string;
  generation: number;
  checkoutOperationId: string;
  checkoutOperationCompleted: boolean;
  checkoutSessionId: string | null;
};
async function rpc<T = Record<string, unknown>>(name: string, args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
  const result = await db.query<{ result: T }>(
    `SELECT public.${name}(${placeholders}) AS result`,
    args,
  );
  return result.rows[0]!.result;
}
const leaseArgs = (claim: Claim) => [
  claim.userId,
  claim.customerId,
  claim.livemode,
  claim.leaseToken,
  claim.generation,
];
const claimCheckout = (requestId = request1, hash = hash1) =>
  rpc<Claim>("billing_claim_checkout", [user1, "cus_owner", false, requestId, hash]);
const claimEvent = (id: string) =>
  rpc<Claim>("billing_claim_event", [id, "customer.subscription.updated", "cus_owner", false]);
const finalizeCheckout = (claim: Claim, id = "cs_test_fixture") =>
  rpc("billing_finalize_checkout", [...leaseArgs(claim), claim.checkoutOperationId, id]);
const failCheckout = (claim: Claim) =>
  rpc("billing_fail_checkout", [...leaseArgs(claim), claim.checkoutOperationId]);
const projection = (overrides: Record<string, unknown> = {}) => ({
  subscriptionId: "sub_owner",
  priceId: "price_pro",
  plan: "pro",
  status: "active",
  currentPeriodStart: new Date().toISOString(),
  currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
  cancelAtPeriodEnd: false,
  canceledAt: null,
  trialEnd: null,
  ...overrides,
});
const finalizeEvent = (
  claim: Claim,
  id: string,
  state = projection(),
  invoice: unknown = null,
  checkout: unknown = null,
) => rpc("billing_finalize_event", [...leaseArgs(claim), id, state, invoice, checkout]);
async function expireLease() {
  await db.query(
    "UPDATE public.billing_customers SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [user1],
  );
}
async function asRole(
  role: "authenticated" | "anon" | "service_role",
  userId: string,
  callback: () => Promise<void>,
) {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [userId]);
  try {
    await callback();
  } finally {
    await db.exec("RESET ROLE");
  }
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at=now(); RETURN NEW; END;
    $$;
  `);
  await db.query("INSERT INTO auth.users(id) VALUES ($1),($2)", [user1, user2]);
  await db.exec(
    readFileSync(resolve("supabase/migrations/20261110231500_subscriptions.sql"), "utf8"),
  );
  await db.exec(
    readFileSync(resolve("supabase/migrations/20261111010000_subscription_invoicing.sql"), "utf8"),
  );
  const legacyAgencyFunction = readFileSync(
    resolve("drizzle/migrations/0003_harden_usage_and_agency.sql"),
    "utf8",
  ).match(/CREATE OR REPLACE FUNCTION public\.has_agency_plan[\s\S]*?\$\$;/)?.[0];
  if (!legacyAgencyFunction) throw new Error("Tracked legacy agency function was not found");
  await db.exec(legacyAgencyFunction);
  await db.exec(
    readFileSync(
      resolve("supabase/migrations/20261116031733_stripe_billing_reconciliation.sql"),
      "utf8",
    ),
  );
}, 30_000);
afterAll(async () => {
  await db?.close();
});

// Sequential cases deliberately exercise one durable customer lifecycle.
describe("billing PostgreSQL migration", () => {
  it("installs, links one owner, and rejects remapping/cross-owner IDs atomically", async () => {
    await asRole("service_role", "", async () => {
      expect(await rpc("billing_link_customer", [user1, "cus_owner", false])).toEqual({
        linked: true,
      });
    });
    expect(await rpc("billing_link_customer", [user1, "cus_owner", false])).toEqual({
      linked: true,
    });
    await expect(rpc("billing_link_customer", [user1, "cus_other", false])).rejects.toThrow();
    await expect(rpc("billing_link_customer", [user2, "cus_owner", false])).rejects.toThrow();
    await expect(rpc("billing_link_customer", [user1, "cus_owner", true])).rejects.toThrow();
    expect((await db.query("SELECT user_id FROM public.billing_customers")).rows).toEqual([
      { user_id: user1 },
    ]);
  });
  it("denies customer-ledger/RPC access and subscription writes to browser roles", async () => {
    await asRole("authenticated", user1, async () => {
      expect((await db.query("SELECT user_id FROM public.subscriptions")).rows).toEqual([
        { user_id: user1 },
      ]);
      await expect(db.query("UPDATE public.subscriptions SET plan='agency'")).rejects.toThrow();
      await expect(db.query("SELECT * FROM public.billing_customers")).rejects.toThrow();
      await expect(rpc("billing_link_customer", [user2, "cus_stolen", false])).rejects.toThrow();
      await expect(claimCheckout()).rejects.toThrow();
    });
    await asRole("authenticated", user2, async () => {
      expect((await db.query("SELECT user_id FROM public.subscriptions")).rows).toEqual([]);
    });
    await asRole("anon", "", async () => {
      await expect(claimCheckout()).rejects.toThrow();
      await expect(db.query("SELECT * FROM public.billing_webhook_events")).rejects.toThrow();
    });
  });
  it("serializes leases, reuses pending operation across lost responses and rejects stale finalize", async () => {
    const first = await claimCheckout();
    expect(first.status).toBe("claimed");
    expect((await claimCheckout()).status).toBe("busy");
    expect((await claimEvent("evt_waits")).status).toBe("busy");
    await expireLease();
    const recovered = await claimCheckout(request2);
    expect(recovered.checkoutOperationId).toBe(first.checkoutOperationId);
    expect(recovered.generation).toBeGreaterThan(first.generation);
    expect(await finalizeCheckout(first)).toEqual({ applied: false });
    expect(await finalizeCheckout(recovered)).toEqual({ applied: true });
    const retry = await claimCheckout(request1);
    expect(retry.checkoutOperationId).toBe(first.checkoutOperationId);
    expect(first.checkoutOperationCompleted).toBe(false);
    expect(retry.checkoutOperationCompleted).toBe(true);
    expect(retry.checkoutSessionId).toBe("cs_test_fixture");
    expect(await finalizeCheckout(retry)).toEqual({ applied: true });
  });
  it("commits subscription state and event completion together, then deduplicates", async () => {
    const claim = await claimEvent("evt_paid");
    expect(await finalizeEvent(claim, "evt_paid")).toEqual({ applied: true });
    expect((await claimEvent("evt_paid")).status).toBe("completed");
    expect(
      (
        await db.query(
          "SELECT plan,status,stripe_subscription_id FROM public.subscriptions WHERE user_id=$1",
          [user1],
        )
      ).rows[0],
    ).toEqual({ plan: "pro", status: "active", stripe_subscription_id: "sub_owner" });
  });
  it("rolls back failed projection without completing event or overwriting subscription", async () => {
    const claim = await claimEvent("evt_invalid");
    await expect(
      finalizeEvent(claim, "evt_invalid", projection({ status: "forged" })),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "SELECT status FROM public.billing_webhook_events WHERE event_id='evt_invalid'",
        )
      ).rows[0],
    ).toEqual({ status: "processing" });
    expect(
      (await db.query("SELECT status FROM public.subscriptions WHERE user_id=$1", [user1])).rows[0],
    ).toEqual({ status: "active" });
    expect(
      await rpc("billing_fail_event", [...leaseArgs(claim), "evt_invalid", "FIXTURE_RETRY"]),
    ).toEqual({ applied: true });
    const retry = await claimEvent("evt_invalid");
    expect(await finalizeEvent(retry, "evt_invalid", projection({ status: "past_due" }))).toEqual({
      applied: true,
    });
  });
  it("prevents expired worker state from overwriting a newer reconciliation", async () => {
    const old = await claimEvent("evt_old_worker");
    await expireLease();
    const fresh = await claimEvent("evt_new_worker");
    expect(await finalizeEvent(fresh, "evt_new_worker", projection({ status: "unpaid" }))).toEqual({
      applied: true,
    });
    expect(await finalizeEvent(old, "evt_old_worker", projection({ status: "active" }))).toEqual({
      applied: false,
    });
    expect(
      (await db.query("SELECT status FROM public.subscriptions WHERE user_id=$1", [user1])).rows[0],
    ).toEqual({ status: "unpaid" });
  });
  it("stores real invoice references once and only lets their owner read them", async () => {
    const invoice = {
      id: "in_fixture",
      subscriptionId: "sub_owner",
      number: "FIXTURE-1",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/fixture",
      invoicePdfUrl: null,
      status: "paid",
      currency: "eur",
      amountPaid: 3900,
      created: 1_800_000_000,
    };
    const a = await claimEvent("evt_invoice_one");
    expect(await finalizeEvent(a, "evt_invoice_one", projection(), invoice)).toEqual({
      applied: true,
    });
    const b = await claimEvent("evt_invoice_two");
    expect(await finalizeEvent(b, "evt_invoice_two", projection(), invoice)).toEqual({
      applied: true,
    });
    expect(
      (await db.query("SELECT count(*)::int AS count FROM public.billing_invoice_references"))
        .rows[0],
    ).toEqual({ count: 1 });
    await asRole("authenticated", user1, async () => {
      expect(
        (await db.query("SELECT invoice_id FROM public.billing_invoice_references")).rows,
      ).toEqual([{ invoice_id: "in_fixture" }]);
    });
    await asRole("authenticated", user2, async () => {
      expect(
        (await db.query("SELECT invoice_id FROM public.billing_invoice_references")).rows,
      ).toEqual([]);
    });
  });
  it("rejects changed input for the same request and retains pending identity after failure", async () => {
    expect((await claimCheckout(request1, "b".repeat(64))).status).toBe("conflict");
    const pending = await claimCheckout("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "c".repeat(64));
    expect(pending.status).toBe("claimed");
    expect(await failCheckout(pending)).toEqual({ applied: true });
    expect(
      (await claimCheckout("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "d".repeat(64))).status,
    ).toBe("conflict");
    const retry = await claimCheckout("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "c".repeat(64));
    expect(retry.checkoutOperationId).toBe(pending.checkoutOperationId);
    expect(await failCheckout(retry)).toEqual({ applied: true });
    await db.query(
      "UPDATE public.billing_checkout_operations SET created_at=clock_timestamp()-interval '24 hours' WHERE operation_id=$1",
      [pending.checkoutOperationId],
    );
    expect(
      (await claimCheckout("ffffffff-ffff-4fff-8fff-ffffffffffff", "c".repeat(64))).status,
    ).toBe("blocked");
  });
  it("requires a future period for the agency SQL entitlement helper", async () => {
    await db.query(
      "UPDATE public.subscriptions SET plan='agency',status='active',current_period_end=NULL WHERE user_id=$1",
      [user1],
    );
    expect(await rpc("has_agency_plan", [user1])).toBe(false);
    await db.query(
      "UPDATE public.subscriptions SET current_period_end=clock_timestamp()+interval '1 day' WHERE user_id=$1",
      [user1],
    );
    expect(await rpc("has_agency_plan", [user1])).toBe(true);
  });
  it("repairs an uncertain checkout from verified session metadata atomically", async () => {
    const pending = (
      await db.query<{ operation_id: string }>(
        "SELECT operation_id FROM public.billing_checkout_operations WHERE status='pending'",
      )
    ).rows[0]!;
    const claim = await claimEvent("evt_checkout_recovery");
    await expect(
      finalizeEvent(claim, "evt_checkout_recovery", projection(), null, {
        operationId: pending.operation_id,
        requestHash: "f".repeat(64),
        sessionId: "cs_test_recovered",
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "SELECT status FROM public.billing_checkout_operations WHERE operation_id=$1",
          [pending.operation_id],
        )
      ).rows[0],
    ).toEqual({ status: "pending" });
    expect(
      await finalizeEvent(claim, "evt_checkout_recovery", projection(), null, {
        operationId: pending.operation_id,
        requestHash: "c".repeat(64),
        sessionId: "cs_test_recovered",
      }),
    ).toEqual({ applied: true });
    expect(
      (
        await db.query(
          "SELECT status,checkout_session_id FROM public.billing_checkout_operations WHERE operation_id=$1",
          [pending.operation_id],
        )
      ).rows[0],
    ).toEqual({ status: "completed", checkout_session_id: "cs_test_recovered" });
    expect((await claimEvent("evt_checkout_recovery")).status).toBe("completed");
  });
});
