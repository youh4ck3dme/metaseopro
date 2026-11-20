import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real PostgreSQL in WASM (in-memory). Never touches a hosted database.
const userA = "11111111-1111-4111-8111-111111111111"; // no agency plan
const userB = "22222222-2222-4222-8222-222222222222"; // active agency plan
const migrationPath = "supabase/migrations/20261117180000_has_agency_plan_self_only.sql";
let db: PGlite;

const read = (path: string) => readFileSync(resolve(path), "utf8");

async function as<T>(
  role: "authenticated" | "anon",
  sub: string | null,
  sql: string,
  args: unknown[] = [],
): Promise<T[] | { error: string }> {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [sub ?? ""]);
  try {
    return (await db.query<T>(sql, args)).rows;
  } catch (error) {
    return { error: (error as Error).message };
  } finally {
    await db.exec("RESET ROLE");
  }
}
const hasPlan = (role: "authenticated" | "anon", sub: string | null, target: string) =>
  as<{ v: boolean }>(role, sub, "SELECT public.has_agency_plan($1) AS v", [target]);
const insertProfile = (sub: string) =>
  as<{ user_id: string }>(
    "authenticated",
    sub,
    "INSERT INTO public.agency_profiles(user_id,agency_name) VALUES ($1,'agency') RETURNING user_id",
    [sub],
  );

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
  await db.query("INSERT INTO auth.users(id) VALUES ($1),($2)", [userA, userB]);
  await db.exec(read("supabase/migrations/20261110231500_subscriptions.sql"));
  await db.exec(read("supabase/migrations/20261110233000_agency_profiles.sql"));
  await db.exec("CREATE TABLE public.content_plan_usage(user_id uuid PRIMARY KEY);");
  await db.exec(read("drizzle/migrations/0003_harden_usage_and_agency.sql"));
  await db.query(
    `INSERT INTO public.subscriptions(user_id,plan,status,current_period_end)
     VALUES ($1,'free','active',now()+interval '1 day'),($2,'agency','active',now()+interval '1 day')`,
    [userA, userB],
  );
}, 30_000);
afterAll(async () => {
  await db?.close();
});

describe("has_agency_plan self-only migration", () => {
  it("reproduces the leak before the migration: A learns B's plan", async () => {
    expect(await hasPlan("authenticated", userA, userB)).toEqual([{ v: true }]);
  });

  describe("after the migration", () => {
    beforeAll(async () => {
      await db.exec(read(migrationPath));
      await db.exec("DELETE FROM public.agency_profiles");
    });

    it("A asking about B gets false (no leak)", async () => {
      expect(await hasPlan("authenticated", userA, userB)).toEqual([{ v: false }]);
    });
    it("B asking about B gets true", async () => {
      expect(await hasPlan("authenticated", userB, userB)).toEqual([{ v: true }]);
    });
    it("A asking about A gets false (no plan)", async () => {
      expect(await hasPlan("authenticated", userA, userA)).toEqual([{ v: false }]);
    });
    it("a session without sub (or a NULL id) gets false, never NULL", async () => {
      expect(await hasPlan("authenticated", null, userB)).toEqual([{ v: false }]);
      expect(
        await as("authenticated", userA, "SELECT public.has_agency_plan(NULL::uuid) AS v"),
      ).toEqual([{ v: false }]);
    });
    it("service_role (no user JWT) always gets false, by design", async () => {
      await db.exec("SET ROLE service_role");
      await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
      try {
        const { rows } = await db.query("SELECT public.has_agency_plan($1) AS v", [userB]);
        expect(rows).toEqual([{ v: false }]);
      } finally {
        await db.exec("RESET ROLE");
      }
    });
    it("grants EXECUTE to authenticated and service_role, not anon or PUBLIC", async () => {
      const { rows } = await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(
        `SELECT has_function_privilege('anon','public.has_agency_plan(uuid)','EXECUTE') AS anon,
                has_function_privilege('authenticated','public.has_agency_plan(uuid)','EXECUTE') AS auth,
                has_function_privilege('service_role','public.has_agency_plan(uuid)','EXECUTE') AS svc`,
      );
      expect(rows).toEqual([{ anon: false, auth: true, svc: true }]);
    });
    it("anon is denied", async () => {
      const result = await hasPlan("anon", null, userB);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toMatch(/permission denied/i);
    });
    it("keeps SECURITY DEFINER and the signature, with an empty search_path", async () => {
      const { rows } = await db.query<{ secdef: boolean; config: string[] | null }>(
        `SELECT prosecdef AS secdef, proconfig AS config FROM pg_proc
         WHERE oid = 'public.has_agency_plan(uuid)'::regprocedure`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.secdef).toBe(true);
      expect(rows[0]!.config).toContain('search_path=""');
    });
    it("agency_profiles policies keep working (agency can insert, non-agency cannot)", async () => {
      expect(await insertProfile(userB)).toEqual([{ user_id: userB }]);
      expect(await insertProfile(userA)).toHaveProperty("error");
    });
  });

  it("is a NOTICE-only no-op when the function does not exist", async () => {
    const empty = await PGlite.create();
    try {
      const notices: string[] = [];
      await empty.exec("CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;");
      await empty.exec(read(migrationPath), { onNotice: (n) => notices.push(n.message ?? "") });
      expect(notices).toEqual([expect.stringContaining("does not exist")]);
      expect(
        (await empty.query("SELECT to_regprocedure('public.has_agency_plan(uuid)') AS f")).rows,
      ).toEqual([{ f: null }]);
    } finally {
      await empty.close();
    }
  });
});
