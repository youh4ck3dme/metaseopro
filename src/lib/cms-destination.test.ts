import { describe, expect, it, vi } from "vitest";
import {
  assertAllowedCmsDestination,
  assertCmsSendRateLimit,
  CMS_SEND_RATE_LIMIT,
  CmsDestinationError,
  destinationHost,
  isHostVerified,
  verifiedDomains,
} from "./cms-destination.server";

const USER = "11111111-1111-4111-8111-111111111111";
const PROPS = [
  { siteUrl: "sc-domain:moj-web.sk", permissionLevel: "siteOwner" },
  { siteUrl: "https://www.druhy-web.sk/", permissionLevel: "siteFullUser" },
];
const listProps = vi.fn(async () => PROPS);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err instanceof CmsDestinationError ? err.code : `UNEXPECTED:${String(err)}`;
  }
}

describe("destinationHost (isSafePublicUrl)", () => {
  it.each([
    "http://127.0.0.1/wp-json/wp/v2/posts",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3000/hook",
    "https://api.localhost/hook",
    "http://metadata.google.internal/computeMetadata/v1/",
    "https://intranet.local/hook",
    "http://10.0.0.5/hook",
    "http://192.168.1.10/hook",
    "http://[::1]/hook",
    "ftp://moj-web.sk/upload",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("rejects unsafe or non-http(s) destination %s", (url) => {
    expect(() => destinationHost(url)).toThrowError(
      expect.objectContaining({ code: "UNSAFE_URL", status: 400 }),
    );
  });

  it("rejects malformed and empty URLs", () => {
    for (const url of ["", "   ", "https://"]) {
      expect(() => destinationHost(url)).toThrowError(CmsDestinationError);
    }
  });

  it("normalizes a bare domain and strips www", () => {
    expect(destinationHost("www.Moj-Web.sk")).toBe("moj-web.sk");
    expect(destinationHost("https://blog.moj-web.sk/wp-json/wp/v2/posts")).toBe("blog.moj-web.sk");
  });
});

describe("verified host matching", () => {
  const domains = verifiedDomains(PROPS);

  it("collects domain properties (with subdomains) and URL-prefix properties (exact host)", () => {
    expect([...domains].sort((a, b) => a.host.localeCompare(b.host))).toEqual([
      { host: "druhy-web.sk", subdomains: false },
      { host: "moj-web.sk", subdomains: true },
    ]);
  });

  it("sc-domain property covers the host and its subdomains only", () => {
    expect(isHostVerified("moj-web.sk", domains)).toBe(true);
    expect(isHostVerified("blog.moj-web.sk", domains)).toBe(true);
    expect(isHostVerified("evil-moj-web.sk", domains)).toBe(false);
    expect(isHostVerified("moj-web.sk.evil.net", domains)).toBe(false);
    expect(isHostVerified("attacker.example", domains)).toBe(false);
  });

  it("URL-prefix property verifies exactly that host, never other subdomains", () => {
    expect(isHostVerified("druhy-web.sk", domains)).toBe(true);
    expect(isHostVerified("evil.druhy-web.sk", domains)).toBe(false);
    expect(isHostVerified("a.b.druhy-web.sk", domains)).toBe(false);
    expect(isHostVerified("druhy-web.sk.evil.net", domains)).toBe(false);
    const prefix = verifiedDomains([
      { siteUrl: "https://shop.example.com/blog/", permissionLevel: "siteOwner" },
    ]);
    expect(isHostVerified("shop.example.com", prefix)).toBe(true);
    expect(isHostVerified("example.com", prefix)).toBe(false);
    expect(isHostVerified("x.shop.example.com", prefix)).toBe(false);
  });

  it("an sc-domain property wins when the same host is also a URL-prefix property", () => {
    const both = verifiedDomains([
      { siteUrl: "https://example.com/", permissionLevel: "siteOwner" },
      { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
    ]);
    expect(isHostVerified("blog.example.com", both)).toBe(true);
  });

  it("assertAllowedCmsDestination refuses a sibling subdomain of a URL-prefix property", async () => {
    expect(
      await codeOf(
        assertAllowedCmsDestination(USER, ["https://evil.druhy-web.sk/hook"], async () => PROPS),
      ),
    ).toBe("DESTINATION_NOT_VERIFIED");
    await expect(
      assertAllowedCmsDestination(USER, ["https://www.druhy-web.sk/hook"], async () => PROPS),
    ).resolves.toBeUndefined();
  });
});

describe("assertAllowedCmsDestination", () => {
  it("allows a verified public destination", async () => {
    await expect(
      assertAllowedCmsDestination(
        USER,
        ["https://moj-web.sk", "https://moj-web.sk/wp-json/wp/v2/posts"],
        listProps,
      ),
    ).resolves.toBeUndefined();
    expect(listProps).toHaveBeenCalledWith(USER);
  });

  it("rejects an arbitrary webhook on a foreign host", async () => {
    expect(
      await codeOf(
        assertAllowedCmsDestination(
          USER,
          ["https://moj-web.sk", "https://hooks.attacker.example/collect"],
          listProps,
        ),
      ),
    ).toBe("DESTINATION_NOT_VERIFIED");
  });

  it("rejects SSRF targets before loading verified properties", async () => {
    const spy = vi.fn(async () => PROPS);
    for (const url of [
      "http://127.0.0.1:8080/",
      "http://169.254.169.254/latest/meta-data/iam/",
      "http://localhost/",
      "http://metadata.google.internal/",
    ]) {
      expect(await codeOf(assertAllowedCmsDestination(USER, [url], spy))).toBe("UNSAFE_URL");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects everything for a user without verified properties", async () => {
    expect(
      await codeOf(assertAllowedCmsDestination(USER, ["https://moj-web.sk"], async () => [])),
    ).toBe("DESTINATION_NOT_VERIFIED");
  });

  it("fails closed when the verified list cannot be loaded", async () => {
    expect(
      await codeOf(
        assertAllowedCmsDestination(USER, ["https://moj-web.sk"], async () => {
          throw new Error("GSC_NOT_CONNECTED");
        }),
      ),
    ).toBe("VERIFICATION_UNAVAILABLE");
  });

  it("rejects a missing user or an empty destination list", async () => {
    expect(await codeOf(assertAllowedCmsDestination("", ["https://moj-web.sk"], listProps))).toBe(
      "DESTINATION_NOT_VERIFIED",
    );
    expect(await codeOf(assertAllowedCmsDestination(USER, [], listProps))).toBe("INVALID_URL");
  });
});

describe("assertCmsSendRateLimit", () => {
  it("allows the configured budget per user and then returns RATE_LIMITED", () => {
    const user = "rl-unit-user-1";
    for (let i = 0; i < CMS_SEND_RATE_LIMIT.limit; i++) {
      expect(() => assertCmsSendRateLimit("deploy", user)).not.toThrow();
    }
    expect(() => assertCmsSendRateLimit("deploy", user)).toThrowError(
      expect.objectContaining({ code: "RATE_LIMITED", status: 429 }),
    );
    // Separate users and actions have separate buckets.
    expect(() => assertCmsSendRateLimit("deploy", "rl-unit-user-2")).not.toThrow();
    expect(() => assertCmsSendRateLimit("save", user)).not.toThrow();
  });
});
