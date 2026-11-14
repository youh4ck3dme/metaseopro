import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-auth.server", () => ({
  requireUser: async () => ({ ok: true, userId: "user-1", email: "user@test.sk" }),
}));

import { Route } from "./raketa-analyze";

type PostHandler = (args: { request: Request }) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (Route.options as any).server.handlers.POST as PostHandler;

const DNS_OK = {
  ok: true,
  status: 200,
  json: async () => ({ Answer: [{ type: 1, data: "93.184.216.34" }] }),
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/raketa-analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "100" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/raketa-analyze error mapping (fail-closed, { error, code })", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 400 + code INVALID_URL for an unparseable own URL", async () => {
    const res = await post({
      request: makeRequest({ ownUrl: "not-a-domain", keyword: "seo" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_URL");
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 + code SSRF_BLOCKED for a private-IP own URL", async () => {
    const res = await post({
      request: makeRequest({ ownUrl: "http://10.1.2.3/", keyword: "seo" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("SSRF_BLOCKED");
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/SSRF/);
  });

  it("returns 502 + code FETCH_FAILED when the upstream fetch fails, with no analysis data", async () => {
    globalThis.fetch = vi.fn((url: unknown) => {
      if (String(url).includes("dns-query")) return Promise.resolve(DNS_OK);
      return Promise.reject(new Error("ECONNREFUSED"));
    }) as unknown as typeof fetch;

    const res = await post({
      request: makeRequest({ ownUrl: "https://mojweb.sk", keyword: "seo" }),
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("FETCH_FAILED");
    expect(typeof body.error).toBe("string");
    expect(body.analysis).toBeUndefined();
  });
});
