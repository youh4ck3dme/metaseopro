import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EMAIL = "klient.tajny@eshop-example.sk";
const OTHER_EMAIL = "cudzi.klient@other-example.sk";
const DROP = { rows: [{ url: "https://x.sk/p", clicksPrev: 100, clicksNow: 20 }] };

const state = vi.hoisted(() => ({
  createClientCalls: 0,
}));

const snapshots = [
  {
    id: "1",
    user_id: "u1",
    site_url: "https://eshop.sk/",
    raw_data: DROP,
    created_at: "2026-01-02",
  },
  {
    id: "2",
    user_id: "u2",
    site_url: "https://cudzi.sk/",
    raw_data: DROP,
    created_at: "2026-01-01",
  },
];
const profiles = [
  { user_id: "u1", email: EMAIL },
  { user_id: "u2", email: OTHER_EMAIL },
];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    state.createClientCalls++;
    return {
      from(table: string) {
        const eq: Array<[string, unknown]> = [];
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.order = () => b;
        b.limit = () => b;
        b.in = () => b;
        b.eq = (k: string, v: unknown) => {
          eq.push([k, v]);
          return b;
        };
        b.then = (res: (v: unknown) => unknown) => {
          let rows = (table === "seo_snapshots" ? snapshots : profiles) as Array<
            Record<string, unknown>
          >;
          for (const [k, v] of eq) rows = rows.filter((r) => r[k] === v);
          return Promise.resolve({ data: rows, error: null }).then(res);
        };
        return b;
      },
    };
  },
}));
import { Route } from "@/routes/api/public/cron-decay-alerts";

type Handler = (args: { request: Request }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GET = (Route.options as any).server.handlers.GET as Handler;

let n = 0;
function req(headers: Record<string, string> = {}, query = ""): Request {
  // unique IP per request so the in-memory IP rate limit never interferes
  return new Request(`http://localhost/api/public/cron-decay-alerts${query}`, {
    headers: { "cf-connecting-ip": `10.0.0.${++n}`, ...headers },
  });
}

let logs: string[] = [];
const logText = () => logs.join("\n");

describe("/api/public/cron-decay-alerts authorization + log hygiene", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    state.createClientCalls = 0;
    process.env.SUPABASE_URL = "http://supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    process.env.CRON_SECRET = "cron-secret-test";
    delete process.env.RESEND_API_KEY;
    logs = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
      });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...saved };
  });

  it("anonymous caller (no secret) is rejected with 401 and nothing is evaluated", async () => {
    const res = await GET({ request: req() });
    expect(res.status).toBe(401);
    expect(state.createClientCalls).toBe(0);
  });

  it("wrong secret (same length and different length) is rejected with 401", async () => {
    for (const wrong of ["cron-secret-tesX", "x", "cron-secret-test-and-more"]) {
      const res = await GET({ request: req({ "x-cron-secret": wrong }) });
      expect(res.status).toBe(401);
    }
    expect(state.createClientCalls).toBe(0);
  });

  it("when CRON_SECRET is unset no secret (not even an empty one) grants a run", async () => {
    delete process.env.CRON_SECRET;
    const variants: Array<Record<string, string>> = [
      { "x-cron-secret": "" },
      { authorization: "Bearer " },
      {},
    ];
    for (const headers of variants) {
      const res = await GET({ request: req(headers) });
      expect(res.status).toBe(401);
    }
    expect(state.createClientCalls).toBe(0);
  });

  it("correct secret ONLY in ?secret= query is rejected with 401 and no sweep runs", async () => {
    for (const query of [
      "?secret=cron-secret-test",
      "?SECRET=cron-secret-test&secret=cron-secret-test",
    ]) {
      const res = await GET({ request: req({}, query) });
      expect(res.status).toBe(401);
    }
    expect(state.createClientCalls).toBe(0);
    expect(logText()).not.toContain("Simulating alert");
    expect(logText()).not.toContain("cron-secret-test");
  });

  it("query secret does not help a wrong header either", async () => {
    const res = await GET({
      request: req({ "x-cron-secret": "wrong" }, "?secret=cron-secret-test"),
    });
    expect(res.status).toBe(401);
    expect(state.createClientCalls).toBe(0);
  });

  it("wrong Authorization does NOT override a correct x-cron-secret (either header may authorize)", async () => {
    const res = await GET({
      request: req({ authorization: "Bearer wrong-value", "x-cron-secret": "cron-secret-test" }),
    });
    expect(res.status).toBe(200);
    expect(state.createClientCalls).toBe(1);
    const text = await res.text();
    for (const e of [EMAIL, OTHER_EMAIL]) {
      expect(text).not.toContain(e);
      expect(logText()).not.toContain(e);
    }
  });

  it("correct Authorization still works when x-cron-secret is wrong", async () => {
    const res = await GET({
      request: req({ authorization: "Bearer cron-secret-test", "x-cron-secret": "wrong-value" }),
    });
    expect(res.status).toBe(200);
  });

  it("both headers wrong or empty -> 401", async () => {
    for (const headers of [
      { authorization: "Bearer wrong", "x-cron-secret": "wrong" },
      { authorization: "Bearer ", "x-cron-secret": "" },
    ]) {
      expect((await GET({ request: req(headers) })).status).toBe(401);
    }
    expect(state.createClientCalls).toBe(0);
  });

  it("a signed-in user JWT is NOT enough: only CRON_SECRET can trigger the sweep", async () => {
    const res = await GET({ request: req({ authorization: "Bearer some.user.jwt" }) });
    expect(res.status).toBe(401);
    expect(state.createClientCalls).toBe(0);
    expect(logText()).not.toContain("Simulating alert");
  });

  it.each([
    ["Authorization: Bearer", { authorization: "Bearer cron-secret-test" }, ""],
    ["x-cron-secret header", { "x-cron-secret": "cron-secret-test" }, ""],
  ])(
    "valid CRON_SECRET via %s runs the sweep for all users without e-mails in logs/response",
    async (_n, headers, query) => {
      const res = await GET({ request: req(headers as Record<string, string>, query) });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text).evaluated).toBe(2);
      expect(logText()).toContain("Simulating alert"); // mock path ran...
      for (const e of [EMAIL, OTHER_EMAIL]) {
        expect(text).not.toContain(e); // ...without leaking addresses
        expect(logText()).not.toContain(e);
      }
    },
  );
});
