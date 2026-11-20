import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runDecayAlertSweep, sendDecayAlertEmail } from "./decay-alerts.server";

const EMAIL = "klient.tajny@eshop-example.sk";
const OTHER_EMAIL = "cudzi.klient@other-example.sk";
const DROP = { rows: [{ url: "https://eshop.sk/p", clicksPrev: 100, clicksNow: 20 }] };
const DROPPED = [
  { url: "https://eshop.sk/p", clicksPrev: 100, clicksNow: 20, lossPct: 80, deltaClicks: -80 },
];

let logs: unknown[][] = [];
function spyConsole() {
  logs = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a);
    });
  }
}
const logText = () =>
  logs
    .map((l) => l.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "))
    .join("\n");

/** Minimal thenable query builder mimicking the supabase-js calls used by the sweep. */
function fakeSupabase(data: { snapshots: unknown[]; profiles: unknown[] }) {
  const calls: { table: string; eq: Array<[string, unknown]> }[] = [];
  const client = {
    from(table: string) {
      const call = { table, eq: [] as Array<[string, unknown]> };
      calls.push(call);
      const result = () => {
        let rows = table === "seo_snapshots" ? data.snapshots : data.profiles;
        for (const [k, v] of call.eq)
          rows = (rows as Array<Record<string, unknown>>).filter((r) => r[k] === v);
        return { data: rows, error: null };
      };
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.in = () => b;
      b.eq = (k: string, v: unknown) => {
        call.eq.push([k, v]);
        return b;
      };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
      return b;
    },
    // Recipients come from the confirmed auth e-mail (never from profiles).
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const p = (data.profiles as Array<{ user_id: string; email: string }>).find(
            (x) => x.user_id === id,
          );
          return {
            data: {
              user: p ? { email: p.email, email_confirmed_at: "2026-01-01T00:00:00Z" } : null,
            },
            error: null,
          };
        },
      },
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

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

describe("decay alerts never log customer e-mails", () => {
  const origKey = process.env.RESEND_API_KEY;
  beforeEach(spyConsole);
  afterEach(() => {
    vi.restoreAllMocks();
    if (origKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = origKey;
  });

  it("sending disabled (no RESEND_API_KEY): logs a masked address, not the e-mail", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await sendDecayAlertEmail({
      toEmail: EMAIL,
      domain: "eshop.sk",
      siteUrl: "https://eshop.sk",
      droppedPages: DROPPED,
    });
    expect(res.simulated).toBe(true);
    expect(logs.length).toBeGreaterThan(0); // the mock line is still logged
    expect(logText()).not.toContain(EMAIL);
    expect(logText()).not.toContain("klient.tajny");
    expect(logText()).toContain("k***@e***");
  });

  it("Resend error body echoing the address is redacted", async () => {
    process.env.RESEND_API_KEY = "re_test_x";
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => `invalid recipient ${EMAIL}`,
    });
    const res = await sendDecayAlertEmail({
      toEmail: EMAIL,
      domain: "eshop.sk",
      siteUrl: "https://eshop.sk",
      droppedPages: DROPPED,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(logText()).toContain("422");
    expect(logText()).not.toContain(EMAIL);
  });

  it("fetch exception whose message contains the address is redacted", async () => {
    process.env.RESEND_API_KEY = "re_test_x";
    const fetchFn = vi.fn().mockRejectedValue(new Error(`boom for ${EMAIL}`));
    const res = await sendDecayAlertEmail({
      toEmail: EMAIL,
      domain: "eshop.sk",
      siteUrl: "https://eshop.sk",
      droppedPages: DROPPED,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(logText()).toContain("boom");
    expect(logText()).not.toContain(EMAIL);
  });

  it("system sweep: neither logs nor response body contain any e-mail", async () => {
    delete process.env.RESEND_API_KEY;
    const { client } = fakeSupabase({ snapshots, profiles });
    const r = await runDecayAlertSweep({ supabase: client });
    expect(r.status).toBe(200);
    expect(r.body.alertsSent).toBe(2);
    const body = JSON.stringify(r.body);
    for (const e of [EMAIL, OTHER_EMAIL]) {
      expect(body).not.toContain(e);
      expect(logText()).not.toContain(e);
    }
    expect(body).toContain("userEmailMasked");
  });
});
