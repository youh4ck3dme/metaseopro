import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const FUTURE = "2099-01-01T00:00:00.000Z";

describe("subscriptions RLS (real PostgreSQL in WASM)", () => {
  let db: PGlite;

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
    await db.query("INSERT INTO auth.users(id) VALUES ($1),($2)", [USER_A, USER_B]);
    await db.exec(
      readFileSync(resolve("supabase/migrations/20261110231500_subscriptions.sql"), "utf8"),
    );
    await db.query(
      "INSERT INTO public.subscriptions(user_id,plan,status,current_period_end) VALUES ($1,'pro','active',$3),($2,'agency','active',$3)",
      [USER_A, USER_B, FUTURE],
    );
  }, 30_000);
  afterAll(async () => {
    await db?.close();
  });

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.exec("SET ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [userId]);
    try {
      return await fn();
    } finally {
      await db.exec("RESET ROLE");
    }
  }

  it("user A sees only their own subscription row, never user B's", async () => {
    const own = await asUser(USER_A, () =>
      db.query<{ plan: string }>("SELECT plan FROM public.subscriptions WHERE user_id=$1", [
        USER_A,
      ]),
    );
    expect(own.rows).toEqual([{ plan: "pro" }]);
    const foreign = await asUser(USER_A, () =>
      db.query("SELECT plan FROM public.subscriptions WHERE user_id=$1", [USER_B]),
    );
    expect(foreign.rows).toEqual([]);
  });

  it("anon cannot read subscriptions", async () => {
    await db.exec("SET ROLE anon");
    try {
      await expect(db.query("SELECT plan FROM public.subscriptions")).rejects.toThrow();
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});

describe("app code never asks the database for another user's plan", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("does not call the has_agency_plan RPC with a client-chosen id", () => {
    const offenders = sourceFiles(resolve("src"))
      .filter((file) => !file.endsWith(join("integrations", "supabase", "types.ts")))
      .filter((file) => /\.rpc\(\s*["'`]has_agency_plan/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
