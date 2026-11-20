import { describe, expect, it, vi } from "vitest";
import {
  assertSafePublicUrl,
  createDohResolver,
  isBlockedIp,
  isSafePublicUrl,
  safeFetch,
  SsrfBlockedError,
  TooManyRedirectsError,
  type DnsResolver,
} from "./ssrf";

const publicResolver: DnsResolver = { resolve: async () => ["93.184.216.34"] };

const resolverFor = (map: Record<string, string[]>): DnsResolver => ({
  resolve: async (hostname) => map[hostname.toLowerCase().replace(/\.+$/, "")] ?? ["93.184.216.34"],
});

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

describe("URL hardening (ports, userinfo, hostname normalization, extra ranges)", () => {
  it("normalizes hostname: uppercase and trailing dot do not bypass localhost block", () => {
    expect(isSafePublicUrl("http://LOCALHOST./")).toBe(false);
    expect(isSafePublicUrl("http://localhost.")).toBe(false);
    expect(isSafePublicUrl("http://LoCaLhOsT/")).toBe(false);
  });

  it("allows only ports 80/443 (or default)", () => {
    expect(isSafePublicUrl("http://example.com:8080/")).toBe(false);
    expect(isSafePublicUrl("https://example.com:2053/")).toBe(false);
    expect(isSafePublicUrl("http://example.com:80/")).toBe(true);
    expect(isSafePublicUrl("https://example.com:443/")).toBe(true);
    expect(isSafePublicUrl("https://example.com/")).toBe(true);
  });

  it("rejects URLs with userinfo", () => {
    expect(isSafePublicUrl("http://user:pass@example.com/")).toBe(false);
    expect(isSafePublicUrl("https://token@example.com/")).toBe(false);
  });

  it("blocks 198.18.0.0/15, 192.0.0.0/24 and all TEST-NETs", () => {
    expect(isSafePublicUrl("http://198.18.0.1/")).toBe(false);
    expect(isSafePublicUrl("http://198.19.255.255/")).toBe(false);
    expect(isSafePublicUrl("http://192.0.0.8/")).toBe(false);
    expect(isSafePublicUrl("http://192.0.2.1/")).toBe(false); // TEST-NET-1
    expect(isSafePublicUrl("http://198.51.100.1/")).toBe(false); // TEST-NET-2
    expect(isSafePublicUrl("http://203.0.113.1/")).toBe(false); // TEST-NET-3
  });

  it("isBlockedIp covers loopback, private, link-local, CGNAT, reserved and IPv4-mapped IPv6", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("198.18.0.1")).toBe(true);
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
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

  const httpCalls = (calls: Array<{ url: string; init?: RequestInit }>) =>
    calls.filter((c) => !c.url.includes("dns-query"));

  it("blocks an initial URL that is already unsafe, without calling fetch", async () => {
    const { fn, calls } = sequentialFetch(() => new Response("x", { status: 200 }));
    await expect(
      safeFetch("http://127.0.0.1:8080/", {}, { fetchFn: fn, resolver: publicResolver }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(calls).toHaveLength(0);
  });

  it("blocks a 302 redirect to the cloud metadata endpoint", async () => {
    const { fn } = sequentialFetch(() => redirectTo("http://169.254.169.254/latest/meta-data"));
    await expect(
      safeFetch("https://mojweb.sk", {}, { fetchFn: fn, resolver: publicResolver }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks 302 redirects to loopback IPv4 and IPv6", async () => {
    for (const target of ["http://127.0.0.1:8080", "http://[::1]/"]) {
      const { fn } = sequentialFetch(() => redirectTo(target));
      await expect(
        safeFetch("https://mojweb.sk", {}, { fetchFn: fn, resolver: publicResolver }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("blocks non-http(s) redirect targets (file:, gopher:)", async () => {
    for (const target of ["file:///etc/passwd", "gopher://example.com/"]) {
      const { fn } = sequentialFetch(() => redirectTo(target));
      await expect(
        safeFetch("https://mojweb.sk", {}, { fetchFn: fn, resolver: publicResolver }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("treats an unparseable Location header as SsrfBlockedError", async () => {
    const { fn } = sequentialFetch(
      () => new Response(null, { status: 302, headers: { location: "http://[::1" } }),
    );
    await expect(
      safeFetch("https://mojweb.sk", {}, { fetchFn: fn, resolver: publicResolver }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("follows a relative redirect on a public domain after re-validation", async () => {
    const { fn, calls } = sequentialFetch((_url, _init, i) =>
      i === 0 ? redirectTo("/ok") : new Response("<html>ok</html>", { status: 200 }),
    );
    const res = await safeFetch(
      "https://mojweb.sk/clanok",
      {},
      { fetchFn: fn, resolver: publicResolver },
    );
    expect(res.status).toBe(200);
    const http = httpCalls(calls);
    expect(http).toHaveLength(2);
    expect(http[1]?.url).toBe("https://mojweb.sk/ok");
    expect(http[0]?.init?.redirect).toBe("manual");
    expect(http[1]?.init?.redirect).toBe("manual");
  });

  it("fails with TooManyRedirectsError after more than 5 redirects", async () => {
    const { fn, calls } = sequentialFetch(() => redirectTo("https://mojweb.sk/dalsi"));
    await expect(
      safeFetch("https://mojweb.sk", {}, { fetchFn: fn, resolver: publicResolver }),
    ).rejects.toBeInstanceOf(TooManyRedirectsError);
    expect(httpCalls(calls)).toHaveLength(6);
  });

  it("switches to GET without body on 303", async () => {
    const { fn, calls } = sequentialFetch((_url, _init, i) =>
      i === 0 ? redirectTo("https://mojweb.sk/ok", 303) : new Response("ok", { status: 200 }),
    );
    const res = await safeFetch(
      "https://mojweb.sk",
      { method: "POST", body: JSON.stringify({ a: 1 }) },
      { fetchFn: fn, resolver: publicResolver },
    );
    expect(res.status).toBe(200);
    const http = httpCalls(calls);
    expect(http[0]?.init?.method).toBe("POST");
    expect(http[1]?.init?.method).toBe("GET");
    expect(http[1]?.init?.body).toBeUndefined();
  });

  it("switches POST + 302 to GET without body and without Content-* headers", async () => {
    const { fn, calls } = sequentialFetch((_url, _init, i) =>
      i === 0 ? redirectTo("https://mojweb.sk/ok", 302) : new Response("ok", { status: 200 }),
    );
    const res = await safeFetch(
      "https://mojweb.sk",
      {
        method: "POST",
        body: JSON.stringify({ a: 1 }),
        headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
      },
      { fetchFn: fn, resolver: publicResolver },
    );
    expect(res.status).toBe(200);
    const http = httpCalls(calls);
    expect(http[1]?.init?.method).toBe("GET");
    expect(http[1]?.init?.body).toBeUndefined();
    const headers = new Headers(http[1]?.init?.headers);
    expect(headers.get("content-type")).toBeNull();
    // same-origin: Authorization sa ponechá
    expect(headers.get("authorization")).toBe("Bearer secret");
  });

  it("keeps method and body on 307/308", async () => {
    const { fn, calls } = sequentialFetch((_url, _init, i) =>
      i === 0 ? redirectTo("https://mojweb.sk/ok", 307) : new Response("ok", { status: 200 }),
    );
    const res = await safeFetch(
      "https://mojweb.sk",
      { method: "POST", body: "payload", headers: { "Content-Type": "application/json" } },
      { fetchFn: fn, resolver: publicResolver },
    );
    expect(res.status).toBe(200);
    const http = httpCalls(calls);
    expect(http[1]?.init?.method).toBe("POST");
    expect(http[1]?.init?.body).toBe("payload");
    expect(new Headers(http[1]?.init?.headers).get("content-type")).toBe("application/json");
  });

  it("drops Authorization/Cookie/Proxy-Authorization on cross-origin redirect but keeps them same-origin", async () => {
    const { fn, calls } = sequentialFetch((_url, _init, i) =>
      i === 0
        ? redirectTo("https://other-site.sk/steal", 302)
        : i === 1
          ? redirectTo("/back", 302)
          : new Response("ok", { status: 200 }),
    );
    // cross-origin hop first
    const res = await safeFetch(
      "https://mojweb.sk",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer wp-secret",
          Cookie: "session=abc",
          "Proxy-Authorization": "Basic xyz",
        },
      },
      { fetchFn: fn, resolver: publicResolver },
    );
    expect(res.status).toBe(200);
    const http = httpCalls(calls);
    const crossHeaders = new Headers(http[1]?.init?.headers);
    expect(crossHeaders.get("authorization")).toBeNull();
    expect(crossHeaders.get("cookie")).toBeNull();
    expect(crossHeaders.get("proxy-authorization")).toBeNull();
    // druhý hop je same-origin (https://other-site.sk/back) — ale auth už bola zhodená na cross-origin
    const backHeaders = new Headers(http[2]?.init?.headers);
    expect(backHeaders.get("authorization")).toBeNull();
  });

  it("keeps Authorization on a same-origin redirect", async () => {
    const { fn, calls } = sequentialFetch((_url, _init, i) =>
      i === 0 ? redirectTo("/dalsi", 302) : new Response("ok", { status: 200 }),
    );
    await safeFetch(
      "https://mojweb.sk",
      { headers: { Authorization: "Bearer wp-secret" } },
      { fetchFn: fn, resolver: publicResolver },
    );
    const http = httpCalls(calls);
    expect(new Headers(http[1]?.init?.headers).get("authorization")).toBe("Bearer wp-secret");
  });
});

describe("safeFetch DNS rebinding protection (injectable resolver)", () => {
  const redirectTo = (location: string, status = 302) =>
    new Response(null, { status, headers: { location } });

  function fetchReturning(handler: (url: string, callIndex: number) => Response) {
    const calls: string[] = [];
    const fn = vi.fn((input: unknown) => {
      const url = String(input);
      calls.push(url);
      return Promise.resolve(handler(url, calls.length - 1));
    });
    return { fn: fn as unknown as typeof fetch, calls };
  }

  it("blocks hostnames that resolve to loopback or metadata IPs (nip.io, localtest.me, A=169.254.169.254)", async () => {
    const resolver = resolverFor({
      "127.0.0.1.nip.io": ["127.0.0.1"],
      "localtest.me": ["127.0.0.1"],
      "metadata.evil.test": ["169.254.169.254"],
    });
    for (const host of ["127.0.0.1.nip.io", "localtest.me", "metadata.evil.test"]) {
      const { fn, calls } = fetchReturning(() => new Response("x", { status: 200 }));
      await expect(
        safeFetch(`https://${host}/`, {}, { fetchFn: fn, resolver }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
      expect(calls.filter((c) => !c.includes("dns-query"))).toHaveLength(0);
    }
  });

  it("blocks a redirect hop whose target resolves to a private IP (checked on every hop)", async () => {
    const resolver = resolverFor({ "evil.sk": ["10.0.0.5"] });
    const { fn } = fetchReturning((_url, i) =>
      i === 0 ? redirectTo("https://evil.sk/x") : new Response("x", { status: 200 }),
    );
    await expect(
      safeFetch("https://mojweb.sk/", {}, { fetchFn: fn, resolver }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks when any of multiple A/AAAA records is non-public", async () => {
    const resolver = resolverFor({ "dual.evil.test": ["93.184.216.34", "192.168.1.1"] });
    const { fn } = fetchReturning(() => new Response("x", { status: 200 }));
    await expect(
      safeFetch("https://dual.evil.test/", {}, { fetchFn: fn, resolver }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("fails closed when DNS resolution throws or returns no records", async () => {
    const failing: DnsResolver = {
      resolve: async () => {
        throw new Error("network down");
      },
    };
    const { fn } = fetchReturning(() => new Response("x", { status: 200 }));
    await expect(
      safeFetch("https://mojweb.sk/", {}, { fetchFn: fn, resolver: failing }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    const empty: DnsResolver = { resolve: async () => [] };
    await expect(
      safeFetch("https://mojweb.sk/", {}, { fetchFn: fn, resolver: empty }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("allows the request when DNS resolves to a public IP", async () => {
    const resolver = resolverFor({});
    const { fn, calls } = fetchReturning(() => new Response("ok", { status: 200 }));
    const res = await safeFetch("https://mojweb.sk/", {}, { fetchFn: fn, resolver });
    expect(res.status).toBe(200);
    expect(calls.filter((c) => !c.includes("dns-query"))).toHaveLength(1);
  });
});

describe("P1-A: IPv6 with embedded IPv4 is blocked via full URL and DoH AAAA", () => {
  const blockedV6 = [
    "[::ffff:7f00:1]", // ::ffff:127.0.0.1 hex
    "[::ffff:a9fe:a9fe]", // ::ffff:169.254.169.254 hex
    "[::7f00:1]", // ::/96 → 127.0.0.1
    "[64:ff9b::7f00:1]", // NAT64 → 127.0.0.1
    "[2002:7f00:1::]", // 6to4 → 127.0.0.1
    "[fec0::1]", // site-local fec0::/10
    "[ff02::1]", // multicast ff00::/8
    "[2001:db8::1]", // documentation
    "[::1]",
    "[fe80::1]",
  ];

  it("blocks every dangerous IPv6 literal through isSafePublicUrl on a full URL", () => {
    for (const addr of blockedV6) {
      expect(isSafePublicUrl(`http://${addr}/`)).toBe(false);
    }
    expect(isSafePublicUrl("http://[2606:4700:4700::1111]/")).toBe(true); // public 2000::/3
  });

  it("blocks the same addresses when safeFetch sees them as URL literals", async () => {
    for (const addr of blockedV6) {
      const fn = vi.fn(() =>
        Promise.resolve(new Response("x", { status: 200 })),
      ) as unknown as typeof fetch;
      await expect(
        safeFetch(`http://${addr}/`, {}, { fetchFn: fn, resolver: publicResolver }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("blocks the same addresses returned as DoH AAAA answers", async () => {
    for (const addr of blockedV6) {
      const resolver: DnsResolver = { resolve: async () => [addr.replace(/^\[|\]$/g, "")] };
      const fn = vi.fn(() =>
        Promise.resolve(new Response("x", { status: 200 })),
      ) as unknown as typeof fetch;
      await expect(
        safeFetch("https://mojweb.sk/", {}, { fetchFn: fn, resolver }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("P2-C: DoH fail-closed on HTTP error or bad Status", () => {
  const dohFetch = (a: () => unknown, aaaa: () => unknown) => {
    const mock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("dns-query")) {
        if (u.includes("type=AAAA")) return Promise.resolve(aaaa());
        if (u.includes("type=A")) return Promise.resolve(a());
      }
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    return { fn: mock as unknown as typeof fetch, mock };
  };

  const publicA = () => ({
    ok: true,
    status: 200,
    json: async () => ({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }),
  });

  it("blocks when the AAAA query returns HTTP 500 even though A returned a public IP", async () => {
    const { fn, mock } = dohFetch(publicA, () => ({ ok: false, status: 500 }));
    await expect(safeFetch("https://mojweb.sk/", {}, { fetchFn: fn })).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(mock.mock.calls.some((c) => !String(c[0]).includes("dns-query"))).toBe(false);
  });

  it("blocks when a DoH query returns Status 2 (SERVFAIL) with an Answer", async () => {
    const { fn } = dohFetch(
      () => ({
        ok: true,
        status: 200,
        json: async () => ({ Status: 2, Answer: [{ type: 1, data: "93.184.216.34" }] }),
      }),
      () => ({ ok: true, status: 200, json: async () => ({ Status: 0, Answer: [] }) }),
    );
    await expect(safeFetch("https://mojweb.sk/", {}, { fetchFn: fn })).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it("DoH resolver has its own timeout", async () => {
    const slow = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    const resolver = createDohResolver(slow, 50);
    await expect(resolver.resolve("mojweb.sk")).rejects.toThrow();
  });
});

describe("P2-B/P3: safeFetch timeout, https→http downgrade, redirect body cancel", () => {
  it("aborts the whole operation after timeoutMs", async () => {
    const fn = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    await expect(
      safeFetch("https://mojweb.sk/", {}, { fetchFn: fn, resolver: publicResolver, timeoutMs: 50 }),
    ).rejects.toThrow();
  });

  it("rejects a redirect from https:// to http://", async () => {
    const fn = vi.fn(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { location: "http://mojweb.sk/x" } }),
      ),
    ) as unknown as typeof fetch;
    await expect(
      safeFetch("https://mojweb.sk/", {}, { fetchFn: fn, resolver: publicResolver }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("cancels the body of a redirect response", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const mockFetch = vi.fn((url: unknown) => {
      if (String(url).includes("dns-query"))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ Answer: [{ type: 1, data: "93.184.216.34" }] }),
        });
      if (!String(url).includes("/ok"))
        return Promise.resolve(
          new Response(stream, { status: 302, headers: { location: "https://mojweb.sk/ok" } }),
        );
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as unknown as typeof fetch;
    const res = await safeFetch(
      "https://mojweb.sk/",
      {},
      { fetchFn: mockFetch, resolver: publicResolver },
    );
    expect(res.status).toBe(200);
    expect(cancelled).toBe(true);
  });
});
