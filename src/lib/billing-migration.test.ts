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
const billingTables = [
  "billing_checkout_operations",
  "billing_checkout_requests",
  "billing_customers",
  "billing_invoice_references",
  "billing_webhook_events",
] as const;
const billingRpcSignatures = [
  "billing_link_customer(uuid,text,boolean)",
  "billing_claim_checkout(uuid,text,boolean,uuid,text)",
  "billing_finalize_checkout(uuid,text,boolean,uuid,bigint,uuid,text)",
  "billing_fail_checkout(uuid,text,boolean,uuid,bigint,uuid)",
  "billing_claim_event(text,text,text,boolean)",
  "billing_finalize_event(uuid,text,boolean,uuid,bigint,text,jsonb,jsonb,jsonb)",
  "billing_fail_event(uuid,text,boolean,uuid,bigint,text,text)",
] as const;
const migrationSql = readFileSync(
  resolve("supabase/migrations/20261116031733_stripe_billing_reconciliation.sql"),
  "utf8",
);
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
  currentSubscriptionId: string | null;
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
  // Model permissive legacy defaults, including PUBLIC inheritance. The migration must
  // replace them on its own objects without depending on the hosted project's defaults.
  await db.exec(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC,anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC,anon,authenticated;
    CREATE TABLE public.fixture_default_acl_probe(id integer);
    CREATE FUNCTION public.fixture_default_acl_probe() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
  `);
  await db.exec(migrationSql);
}, 30_000);
afterAll(async () => {
  await db?.close();
});

// Sequential cases deliberately exercise one durable customer lifecycle.
describe("billing PostgreSQL migration", () => {
  it("declares explicit table grants immediately after creation and before RLS", () => {
    for (const table of billingTables) {
      const createStart = migrationSql.indexOf(`CREATE TABLE public.${table} (`);
      expect(createStart).toBeGreaterThanOrEqual(0);
      const createEnd = migrationSql.indexOf("\n);", createStart) + "\n);".length;
      expect(createEnd).toBeGreaterThan(createStart);
      const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(migrationSql.slice(createEnd, createEnd + 500)).toMatch(
        new RegExp(
          `^\\s*REVOKE ALL ON public\\.${escapedTable} FROM public, anon, authenticated;` +
            `\\s*GRANT ALL ON public\\.${escapedTable} TO service_role;`,
        ),
      );
      const grantAt = migrationSql.indexOf(`GRANT ALL ON public.${table} TO service_role;`);
      const rlsAt = migrationSql.indexOf(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(grantAt).toBeLessThan(rlsAt);
    }
    expect(
      migrationSql.indexOf("GRANT SELECT ON public.billing_invoice_references TO authenticated;"),
    ).toBeLessThan(
      migrationSql.indexOf(
        "ALTER TABLE public.billing_invoice_references ENABLE ROW LEVEL SECURITY;",
      ),
    );
  });
  it("preserves UUID ownership keys and billing foreign keys without adding auth foreign keys", async () => {
    const columns = await db.query(
      `
      SELECT c.relname AS table_name,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='user_id'
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname
    `,
      [billingTables],
    );
    expect(columns.rows).toEqual(
      billingTables.map((table_name) => ({ table_name, data_type: "uuid", not_null: true })),
    );
    const primaryKeys = await db.query(
      `
      SELECT c.relname AS table_name,array_agg(a.attname ORDER BY k.ordinality) AS columns
      FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY AS k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
      WHERE p.contype='p' AND n.nspname='public' AND c.relname=ANY($1::text[])
      GROUP BY c.relname ORDER BY c.relname
    `,
      [billingTables],
    );
    expect(primaryKeys.rows).toEqual([
      { table_name: "billing_checkout_operations", columns: ["operation_id"] },
      { table_name: "billing_checkout_requests", columns: ["user_id", "request_id"] },
      { table_name: "billing_customers", columns: ["user_id"] },
      { table_name: "billing_invoice_references", columns: ["invoice_id"] },
      { table_name: "billing_webhook_events", columns: ["event_id"] },
    ]);
    const foreignKeys = await db.query(
      `
      SELECT c.relname AS table_name,a.attname AS column_name,
        rn.nspname AS target_schema,rc.relname AS target_table,ra.attname AS target_column,
        p.confdeltype AS on_delete
      FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class rc ON rc.oid=p.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=p.conkey[1]
      JOIN pg_attribute ra ON ra.attrelid=rc.oid AND ra.attnum=p.confkey[1]
      WHERE p.contype='f' AND n.nspname='public' AND c.relname=ANY($1::text[])
      ORDER BY c.relname,a.attname
    `,
      [billingTables],
    );
    expect(foreignKeys.rows).toEqual([
      {
        table_name: "billing_checkout_operations",
        column_name: "customer_id",
        target_schema: "public",
        target_table: "billing_customers",
        target_column: "stripe_customer_id",
        on_delete: "a",
      },
      {
        table_name: "billing_checkout_requests",
        column_name: "operation_id",
        target_schema: "public",
        target_table: "billing_checkout_operations",
        target_column: "operation_id",
        on_delete: "c",
      },
      {
        table_name: "billing_invoice_references",
        column_name: "customer_id",
        target_schema: "public",
        target_table: "billing_customers",
        target_column: "stripe_customer_id",
        on_delete: "a",
      },
      {
        table_name: "billing_webhook_events",
        column_name: "customer_id",
        target_schema: "public",
        target_table: "billing_customers",
        target_column: "stripe_customer_id",
        on_delete: "a",
      },
    ]);
  });
  it("accepts a detached user UUID but still rejects missing billing parents", async () => {
    const detachedUser = "33333333-3333-4333-8333-333333333333";
    expect((await db.query("SELECT id FROM auth.users WHERE id=$1", [detachedUser])).rows).toEqual(
      [],
    );
    await asRole("service_role", "", async () => {
      try {
        await db.query(
          "INSERT INTO public.billing_customers(user_id,stripe_customer_id,livemode) VALUES ($1,'cus_detached',false)",
          [detachedUser],
        );
        expect(
          (
            await db.query("SELECT user_id FROM public.billing_customers WHERE user_id=$1", [
              detachedUser,
            ])
          ).rows,
        ).toEqual([{ user_id: detachedUser }]);
      } finally {
        await db.query("DELETE FROM public.billing_customers WHERE user_id=$1", [detachedUser]);
      }
      const invalidParents = [
        [
          "INSERT INTO public.billing_checkout_operations(user_id,customer_id,livemode,request_hash) VALUES ($1,'cus_missing',false,$2)",
          [user1, hash1],
        ],
        [
          "INSERT INTO public.billing_checkout_requests(user_id,request_id,request_hash,operation_id) VALUES ($1,$2,$3,$2)",
          [user1, request1, hash1],
        ],
        [
          "INSERT INTO public.billing_webhook_events(event_id,user_id,customer_id,livemode,event_type,status) VALUES ('evt_missing_parent',$1,'cus_missing',false,'invoice.paid','processing')",
          [user1],
        ],
        [
          "INSERT INTO public.billing_invoice_references(invoice_id,user_id,customer_id,livemode,currency,amount_paid,stripe_created) VALUES ('in_missing_parent',$1,'cus_missing',false,'eur',0,0)",
          [user1],
        ],
      ] as const;
      for (const [sql, args] of invalidParents) {
        await expect(db.query(sql, [...args])).rejects.toMatchObject({ code: "23503" });
      }
    });
  });
  it("removes inherited PUBLIC/default table access and explicitly grants only the intended roles", async () => {
    const defaultProbe = await db.query(`
      SELECT has_table_privilege('anon','public.fixture_default_acl_probe','INSERT') AS anon_insert,
        has_function_privilege('authenticated','public.fixture_default_acl_probe()','EXECUTE') AS authenticated_execute,
        EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
          WHERE c.oid='public.fixture_default_acl_probe'::regclass AND acl.grantee=0 AND acl.privilege_type='INSERT') AS public_insert,
        EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
          WHERE p.oid='public.fixture_default_acl_probe()'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
    `);
    expect(defaultProbe.rows[0]).toEqual({
      anon_insert: true,
      authenticated_execute: true,
      public_insert: true,
      public_execute: true,
    });
    const permissions = await db.query<{
      table_name: string;
      role: string;
      privilege: string;
      allowed: boolean;
    }>(
      `
      SELECT c.relname AS table_name,r.role,p.privilege,has_table_privilege(r.role,c.oid,p.privilege) AS allowed
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(role)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS p(privilege)
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    `,
      [billingTables],
    );
    expect(permissions.rows).toHaveLength(billingTables.length * 3 * 7);
    for (const row of permissions.rows) {
      expect(row.allowed, `${row.role} ${row.privilege} ${row.table_name}`).toBe(
        row.role === "service_role" ||
          (row.role === "authenticated" &&
            row.table_name === "billing_invoice_references" &&
            row.privilege === "SELECT"),
      );
    }
    const publicGrants = await db.query(
      `
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) acl
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND acl.grantee=0
    `,
      [billingTables],
    );
    expect(publicGrants.rows).toEqual([]);
    const rls = await db.query(
      `
      SELECT relname AS table_name,relrowsecurity AS enabled,relforcerowsecurity AS forced
      FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) ORDER BY relname
    `,
      [billingTables],
    );
    expect(rls.rows).toEqual(
      billingTables.map((table_name) => ({ table_name, enabled: true, forced: true })),
    );
  });
  it("grants every mutating billing RPC only to service_role despite inherited function defaults", async () => {
    for (const signature of billingRpcSignatures) {
      const permissions = await db.query(
        `
        SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
          has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,
          has_function_privilege('service_role',$1,'EXECUTE') AS service_role,
          p.prosecdef AS security_definer,
          EXISTS (SELECT 1 FROM aclexplode(p.proacl) acl WHERE acl.grantee=0) AS public_grant
        FROM pg_proc p WHERE p.oid=$1::regprocedure
      `,
        [`public.${signature}`],
      );
      expect(permissions.rows[0], signature).toEqual({
        anon: false,
        authenticated: false,
        service_role: true,
        security_definer: false,
        public_grant: false,
      });
    }
  });
  it.each(["anon", "authenticated"] as const)(
    "rejects billing writes and all mutating RPC calls as %s",
    async (role) => {
      await asRole(role, role === "authenticated" ? user1 : "", async () => {
        for (const table of billingTables) {
          if (role === "anon" || table !== "billing_invoice_references") {
            await expect(db.query(`SELECT * FROM public.${table}`)).rejects.toMatchObject({
              code: "42501",
            });
          }
          await expect(
            db.query(`INSERT INTO public.${table} DEFAULT VALUES`),
          ).rejects.toMatchObject({ code: "42501" });
          await expect(
            db.query(`UPDATE public.${table} SET user_id=$1 WHERE false`, [user1]),
          ).rejects.toMatchObject({ code: "42501" });
          await expect(db.query(`DELETE FROM public.${table} WHERE false`)).rejects.toMatchObject({
            code: "42501",
          });
        }
        for (const signature of billingRpcSignatures) {
          const name = signature.slice(0, signature.indexOf("("));
          const types = signature.slice(signature.indexOf("(") + 1, -1).split(",");
          await expect(
            db.query(`SELECT public.${name}(${types.map((type) => `NULL::${type}`).join(",")})`),
          ).rejects.toMatchObject({ code: "42501" });
        }
      });
    },
  );
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
    const lease = await db.query<{ remaining_seconds: number }>(
      "SELECT extract(epoch FROM (lease_expires_at-clock_timestamp()))::double precision AS remaining_seconds FROM public.billing_customers WHERE user_id=$1",
      [user1],
    );
    expect(lease.rows[0]!.remaining_seconds).toBeGreaterThan(170);
    expect(lease.rows[0]!.remaining_seconds).toBeLessThanOrEqual(180);
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
      "UPDATE public.billing_checkout_operations SET created_at=clock_timestamp()-interval '22 hours 59 minutes' WHERE operation_id=$1",
      [pending.checkoutOperationId],
    );
    const beforeBoundary = await claimCheckout(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "c".repeat(64),
    );
    expect(beforeBoundary.status).toBe("claimed");
    expect(beforeBoundary.checkoutOperationId).toBe(pending.checkoutOperationId);
    expect(await failCheckout(beforeBoundary)).toEqual({ applied: true });
    await db.query(
      "UPDATE public.billing_checkout_operations SET created_at=clock_timestamp()-interval '23 hours 1 second' WHERE operation_id=$1",
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
  it("returns a new checkout operation with the previous session pointer after subscription cancellation", async () => {
    const previous = (
      await db.query<{ operation_id: string }>(
        "SELECT operation_id FROM public.billing_checkout_operations WHERE status='completed' AND checkout_session_id='cs_test_recovered'",
      )
    ).rows[0]!;
    const cancellation = await claimEvent("evt_canceled_resubscribe");
    expect(
      await finalizeEvent(
        cancellation,
        "evt_canceled_resubscribe",
        projection({
          status: "canceled",
          currentPeriodEnd: new Date(Date.now() - 60_000).toISOString(),
          canceledAt: new Date().toISOString(),
        }),
      ),
    ).toEqual({ applied: true });
    const next = await claimCheckout("99999999-9999-4999-8999-999999999999");
    expect(next.status).toBe("claimed");
    expect(next.checkoutOperationId).not.toBe(previous.operation_id);
    expect(next.checkoutOperationCompleted).toBe(false);
    expect(next.currentSubscriptionId).toBe("sub_owner");
    // The server must inspect the prior session/subscription before deciding whether
    // this pointer is an open checkout to reuse or a completed historical checkout.
    expect(next.checkoutSessionId).toBe("cs_test_recovered");
    expect(
      (
        await db.query(
          "SELECT status,checkout_session_id FROM public.billing_checkout_operations WHERE operation_id=$1",
          [next.checkoutOperationId],
        )
      ).rows[0],
    ).toEqual({ status: "pending", checkout_session_id: null });
    expect(await failCheckout(next)).toEqual({ applied: true });
  });
});
