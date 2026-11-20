import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/api-auth.server", () => ({
  requireUser: async () => ({ ok: true, userId: auth.userId }),
}));

import { Route as CtrBoostRoute } from "@/routes/api/ctr-boost";

type PostHandler = (args: { request: Request }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctrBoostPost = (CtrBoostRoute.options as any).server.handlers.POST as PostHandler;

const ADMIN_ID = "00000000-0000-4000-8000-0000000000aa";

function badJsonRequest(): Request {
  return new Request("http://localhost/api/ctr-boost", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "8" },
    body: "not-json",
  });
}

// Every per-user plan/quota rate limit on paid/AI endpoints goes through the single
// superadmin gate. Public endpoints (stripe-webhook, cron) stay IP-limited.
const GATED_ROUTES = [
  "audit-domains",
  "ctr-boost",
  "decay-analyze",
  "decay-generate-plan",
  "decay-gsc-properties",
  "generate-article",
  "generate-brief",
  "raketa-analyze",
  "raketa-generate",
];

beforeEach(() => {
  vi.stubEnv("ADMIN_USER_IDS", ADMIN_ID);
  vi.stubEnv("ADMIN_EMAILS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("API rate limits are routed through checkViewerRateLimit", () => {
  it.each(GATED_ROUTES)("%s uses the shared viewer gate, not checkRateLimit", (name) => {
    const source = readFileSync(resolve(process.cwd(), `src/routes/api/${name}.ts`), "utf8");
    expect(source).toContain('from "@/lib/viewer-role.server"');
    expect(source).toMatch(/checkViewerRateLimit\(\{ id: auth\.userId \}/);
    expect(source).not.toMatch(/\bcheckRateLimit\(/);
  });

  it("superadmin is never rate limited on /api/ctr-boost (limit 15/min)", async () => {
    auth.userId = ADMIN_ID;
    for (let i = 0; i < 20; i++) {
      const res = await ctrBoostPost({ request: badJsonRequest() });
      expect(res.status).toBe(400);
    }
  });

  it("regular user still hits 429 on /api/ctr-boost after 15 requests", async () => {
    auth.userId = `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 16; i++) {
      statuses.push((await ctrBoostPost({ request: badJsonRequest() })).status);
    }
    expect(statuses.slice(0, 15).every((s) => s === 400)).toBe(true);
    expect(statuses[15]).toBe(429);
  });
});
