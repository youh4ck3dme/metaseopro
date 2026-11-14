import { describe, expect, it, vi } from "vitest";
import {
  assertSafePublicUrl,
  isSafePublicUrl,
  safeFetch,
  SsrfBlockedError,
  TooManyRedirectsError,
} from "./ssrf";

describe("SSRF Protection & URL Safety Validator", () => {
  it("blocks localhost, loopback and private networks", () => {
    expect(isSafePublicUrl("http://localhost/wp-json")).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.1:8080/wp-json")).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.2")).toBe(false);
    expect(isSafePublicUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafePublicUrl("http://10.1.2.3/api")).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.100/posts")).toBe(false);
    expect(isSafePublicUrl("http://172.20.0.5/api")).toBe(false);
    expect(isSafePublicUrl("http://0.0.0.0")).toBe(false);
    expect(isSafePublicUrl("ftp://example.com/api")).toBe(false);
    expect(isSafePublicUrl("http://internal.server.local")).toBe(false);
    expect(isSafePublicUrl("http://dev.internal")).toBe(false);
    expect(isSafePublicUrl("http://myhost.lan")).toBe(false);
  });

  it("blocks IPv6 loopback and link-local addresses", () => {
    expect(isSafePublicUrl("http://[::1]/")).toBe(false);
    expect(isSafePublicUrl("http://[fe80::1]/")).toBe(false);
    expect(isSafePublicUrl("http://[fc00::1]/")).toBe(false);
  });

  it("permits legitimate public web URLs", () => {
    expect(isSafePublicUrl("https://mojweb.sk")).toBe(true);
    expect(isSafePublicUrl("https://blog.firma.cz/wp-json/wp/v2/posts")).toBe(true);
    expect(isSafePublicUrl("http://google.com")).toBe(true);
    expect(isSafePublicUrl("https://eshop.subdomain.eu/kategoria")).toBe(true);
  });

  it("assertSafePublicUrl throws on blocked addresses and passes on valid ones", () => {
    expect(() => assertSafePublicUrl("http://127.0.0.1:8080")).toThrow(/loopback IP/);
    expect(() => assertSafePublicUrl("http://169.254.169.254")).toThrow(/metadata service/);
    expect(() => assertSafePublicUrl("http://10.0.0.1")).toThrow(/privátna sieť/);
    expect(() => assertSafePublicUrl("https://mojweb.sk")).not.toThrow();
  });
});

describe("safeFetch re-validates every redirect target (SSRF)", () => {
  const redirectTo = (location: string, status = 302) =>
    new Response(null, { status, headers: { location } });

  function sequentialFetch(
    handler: (url: string, init: RequestInit | undefined, callIndex: number) => Response,
  ) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fn = vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return Promise.resolve(handler(url, init, calls.length - 1));
    });
    return { fn: fn as unknown as typeof fetch, calls };
  }

  it("blocks an initial URL that is already unsafe, without calling fetch", async () => {
    const { fn, calls } = sequentialFetch(() => new Response("x", { status: 200 }));
    await expect(safeFetch("http://127.0.0.1:8080/", {}, { fetchFn: fn })).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(calls).toHaveLength(0);
  });

  it("blocks a 302 redirect to the cloud metadata endpoint", async () => {
    const { fn } = sequentialFetch(() => redirectTo("http://169.254.169.254/latest/meta-data"));
    await expect(safeFetch("https://mojweb.sk", {}, { fetchFn: fn })).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it("blocks 302 redirects to loopback IPv4 and IPv6", async () => {
    for (const target of ["http://127.0.0.1:8080", "http://[::1]/"]) {
      const { fn } = sequentialFetch(() => redirectTo(target));
      await expect(safeFetch("https://mojweb.sk", {}, { fetchFn: fn })).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    }
  });

  it("blocks non-http(s) redirect targets (file:, gopher:)", async () => {
    for (const target of ["file:///etc/passwd", "gopher://example.com/"]) {
      const { fn } = sequentialFetch(() => redirectTo(target));
      await expect(safeFetch("https://mojweb.sk", {}, { fetchFn: fn })).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    }
  });

  it("follows a relative redirect on a public domain after re-validation", async () => {
    const { fn, calls } = sequentialFetch((_url, _init, i) =>
      i === 0 ? redirectTo("/ok") : new Response("<html>ok</html>", { status: 200 }),
    );
    const res = await safeFetch("https://mojweb.sk/clanok", {}, { fetchFn: fn });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://mojweb.sk/ok");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(calls[1]?.init?.redirect).toBe("manual");
  });

  it("fails with TooManyRedirectsError after more than 5 redirects", async () => {
    const { fn, calls } = sequentialFetch(() => redirectTo("https://mojweb.sk/dalsi"));
    await expect(safeFetch("https://mojweb.sk", {}, { fetchFn: fn })).rejects.toBeInstanceOf(
      TooManyRedirectsError,
    );
    expect(calls).toHaveLength(6);
  });

  it("switches to GET without body on 303", async () => {
    const { fn, calls } = sequentialFetch((_url, _init, i) =>
      i === 0 ? redirectTo("https://mojweb.sk/ok", 303) : new Response("ok", { status: 200 }),
    );
    const res = await safeFetch(
      "https://mojweb.sk",
      { method: "POST", body: JSON.stringify({ a: 1 }) },
      { fetchFn: fn },
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.method).toBe("GET");
    expect(calls[1]?.init?.body).toBeUndefined();
  });
});
