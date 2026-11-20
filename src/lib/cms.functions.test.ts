import { beforeEach, describe, expect, it, vi } from "vitest";

const VERIFIED_WP = {
  site_url: "https://moj-web.sk",
  platform: "wordpress",
  api_endpoint: "https://moj-web.sk/wp-json/wp/v2/posts",
  credentials_encrypted: "user:app-password-fixture",
  seo_plugin: "yoast",
};

const mocks = vi.hoisted(() => {
  const state = {
    userId: null as string | null,
    rows: [] as Array<Record<string, unknown>>,
    writes: [] as Array<{ op: string; payload: unknown }>,
    verifiedSites: [{ siteUrl: "sc-domain:moj-web.sk", permissionLevel: "siteOwner" }] as Array<{
      siteUrl: string;
      permissionLevel: string;
    }>,
    gscFails: false,
  };
  function query() {
    let op = "select";
    let payload: unknown;
    const result = () => {
      if (op !== "select") state.writes.push({ op, payload });
      return { data: op === "insert" ? { id: "conn-new" } : state.rows, error: null };
    };
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      insert(p: unknown) {
        op = "insert";
        payload = p;
        return q;
      },
      update(p: unknown) {
        op = "update";
        payload = p;
        return q;
      },
      async single() {
        const r = result();
        return op === "select" ? { data: state.rows[0] ?? null, error: null } : r;
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve);
      },
    };
    return q;
  }
  const supabase = { from: () => query() };
  const requireSupabaseAuth = {
    authorize: async () => {
      if (!state.userId) throw new Error("Unauthorized: No authorization header provided");
      return { userId: state.userId, supabase, claims: { sub: state.userId } };
    },
  };
  const publishToWordPress = vi.fn(async () => ({ success: true, message: "ok" }));
  const publishToCustomWebhook = vi.fn(async () => ({ success: true, message: "ok" }));
  const testWordPressConnection = vi.fn(async () => ({ ok: true, message: "ok" }));
  const listUserVerifiedProperties = vi.fn(async (..._args: unknown[]) => {
    if (state.gscFails) throw new Error("GSC_NOT_CONNECTED");
    return state.verifiedSites;
  });
  const setResponseStatus = vi.fn((_code?: number) => undefined);
  const setResponseHeader = vi.fn((_name: string, _value: string) => undefined);
  return {
    state,
    setResponseStatus,
    setResponseHeader,
    requireSupabaseAuth,
    publishToWordPress,
    publishToCustomWebhook,
    testWordPressConnection,
    listUserVerifiedProperties,
  };
});

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (data: unknown) => data;
    let middleware: unknown[] = [];
    const builder = {
      middleware(items: unknown[]) {
        middleware = items;
        return builder;
      },
      validator(fn: (data: unknown) => unknown) {
        validate = fn;
        return builder;
      },
      handler(_rpc: unknown, fn: (args: { data: unknown; context: unknown }) => Promise<unknown>) {
        return {
          __executeServer: async (args: { data?: unknown } = {}) => {
            if (!middleware.includes(mocks.requireSupabaseAuth)) {
              throw new Error("Missing auth middleware on provider handler");
            }
            const context = await mocks.requireSupabaseAuth.authorize();
            return fn({ data: validate(args.data), context });
          },
        };
      },
    };
    return builder;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  setResponseStatus: mocks.setResponseStatus,
  setResponseHeader: mocks.setResponseHeader,
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: mocks.requireSupabaseAuth,
}));
vi.mock("./cms-publisher.server", () => ({
  publishToWordPress: mocks.publishToWordPress,
  publishToCustomWebhook: mocks.publishToCustomWebhook,
  testWordPressConnection: mocks.testWordPressConnection,
}));
vi.mock("./gsc.server", () => ({
  listUserVerifiedProperties: mocks.listUserVerifiedProperties,
}));

// @ts-expect-error TanStack's Vite compiler supplies this provider module and its generated exports.
import * as provider from "./cms.functions?tss-serverfn-split";

type Fn = (args?: { data?: unknown }) => Promise<unknown>;
const deploy = provider.deployContentToCms_createServerFn_handler as Fn;
const save = provider.saveUserCmsConnection_createServerFn_handler as Fn;
const testBeforeSave = provider.testConnectionBeforeSave_createServerFn_handler as Fn;

let userSeq = 0;
function signIn() {
  userSeq += 1;
  mocks.state.userId = `00000000-0000-4000-8000-${String(userSeq).padStart(12, "0")}`;
  return mocks.state.userId;
}

const sent = () =>
  mocks.publishToWordPress.mock.calls.length + mocks.publishToCustomWebhook.mock.calls.length;

beforeEach(() => {
  mocks.state.userId = null;
  mocks.state.rows = [];
  mocks.state.writes = [];
  mocks.state.gscFails = false;
  mocks.state.verifiedSites = [{ siteUrl: "sc-domain:moj-web.sk", permissionLevel: "siteOwner" }];
  mocks.publishToWordPress.mockClear();
  mocks.publishToCustomWebhook.mockClear();
  mocks.testWordPressConnection.mockClear();
  mocks.listUserVerifiedProperties.mockClear();
  mocks.setResponseStatus.mockClear();
  mocks.setResponseHeader.mockClear();
});

const lastStatus = () => mocks.setResponseStatus.mock.calls.at(-1)?.[0];

describe("deployContentToCms destination guard", () => {
  it("rejects unauthenticated callers and sends nothing", async () => {
    await expect(deploy({ data: { connectionId: crypto.randomUUID() } })).rejects.toThrow(
      /Unauthorized/,
    );
    expect(sent()).toBe(0);
  });

  it("publishes to a verified destination", async () => {
    const userId = signIn();
    mocks.state.rows = [VERIFIED_WP];
    await expect(
      deploy({ data: { connectionId: crypto.randomUUID(), title: "T", content: "C" } }),
    ).resolves.toMatchObject({ success: true });
    expect(mocks.publishToWordPress).toHaveBeenCalledTimes(1);
    // Verified by user id only: no email, so the ADMIN_EMAILS fallback cannot apply.
    expect(mocks.listUserVerifiedProperties).toHaveBeenCalledWith(userId);
  });

  it("refuses a stored arbitrary webhook (row written directly through RLS)", async () => {
    signIn();
    mocks.state.rows = [
      {
        ...VERIFIED_WP,
        platform: "custom_webhook",
        api_endpoint: "https://hooks.attacker.example/collect",
      },
    ];
    await expect(deploy({ data: { connectionId: crypto.randomUUID() } })).rejects.toMatchObject({
      code: "DESTINATION_NOT_VERIFIED",
    });
    expect(sent()).toBe(0);
  });

  it("refuses a stored site_url that is not verified even with a verified endpoint", async () => {
    signIn();
    mocks.state.rows = [{ ...VERIFIED_WP, site_url: "https://victim.example" }];
    await expect(deploy({ data: { connectionId: crypto.randomUUID() } })).rejects.toMatchObject({
      code: "DESTINATION_NOT_VERIFIED",
    });
    expect(sent()).toBe(0);
  });

  it.each([
    "http://127.0.0.1:8080/hook",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost/hook",
    "http://metadata.google.internal/computeMetadata/v1/",
  ])("refuses a stored SSRF endpoint %s", async (endpoint) => {
    signIn();
    mocks.state.rows = [{ ...VERIFIED_WP, platform: "custom_webhook", api_endpoint: endpoint }];
    await expect(deploy({ data: { connectionId: crypto.randomUUID() } })).rejects.toMatchObject({
      code: "UNSAFE_URL",
    });
    expect(sent()).toBe(0);
  });

  it("does not fall back to an unrelated connection when siteUrl does not match", async () => {
    signIn();
    mocks.state.rows = [VERIFIED_WP];
    await expect(deploy({ data: { siteUrl: "https://iny-web.sk" } })).rejects.toThrow(
      /Nebolo nájdené žiadne CMS pripojenie/,
    );
    expect(sent()).toBe(0);
  });

  it("fails closed when Search Console verification is unavailable", async () => {
    signIn();
    mocks.state.rows = [VERIFIED_WP];
    mocks.state.gscFails = true;
    await expect(deploy({ data: { connectionId: crypto.randomUUID() } })).rejects.toMatchObject({
      code: "VERIFICATION_UNAVAILABLE",
    });
    expect(sent()).toBe(0);
    expect(lastStatus()).toBe(503);
  });

  it("maps destination errors to the HTTP status of the response", async () => {
    signIn();
    mocks.state.rows = [
      { ...VERIFIED_WP, platform: "custom_webhook", api_endpoint: "https://evil.example/hook" },
    ];
    await expect(deploy({ data: { connectionId: crypto.randomUUID() } })).rejects.toMatchObject({
      code: "DESTINATION_NOT_VERIFIED",
    });
    expect(lastStatus()).toBe(403);

    mocks.state.rows = [
      { ...VERIFIED_WP, platform: "custom_webhook", api_endpoint: "http://127.0.0.1/hook" },
    ];
    await expect(deploy({ data: { connectionId: crypto.randomUUID() } })).rejects.toMatchObject({
      code: "UNSAFE_URL",
    });
    expect(lastStatus()).toBe(400);
    expect(sent()).toBe(0);
  });

  it("does not set an error status on a successful deploy", async () => {
    signIn();
    mocks.state.rows = [VERIFIED_WP];
    await deploy({ data: { connectionId: crypto.randomUUID() } });
    expect(mocks.setResponseStatus).not.toHaveBeenCalled();
  });

  it("rate limits deploys per user", async () => {
    signIn();
    mocks.state.rows = [VERIFIED_WP];
    for (let i = 0; i < 10; i++) {
      await deploy({ data: { connectionId: crypto.randomUUID() } });
    }
    await expect(deploy({ data: { connectionId: crypto.randomUUID() } })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    expect(sent()).toBe(10);
    expect(lastStatus()).toBe(429);
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(
      "Retry-After",
      expect.stringMatching(/^\d+$/),
    );
  });
});

describe("saveUserCmsConnection destination guard", () => {
  const base = {
    siteUrl: "https://moj-web.sk",
    platform: "custom_webhook",
    credentials: "token-fixture",
    seoPlugin: "core",
  };

  it("saves a verified destination", async () => {
    signIn();
    await expect(
      save({ data: { ...base, apiEndpoint: "https://moj-web.sk/api/seo-hook" } }),
    ).resolves.toMatchObject({ success: true, action: "created" });
    expect(mocks.state.writes).toHaveLength(1);
  });

  it.each([
    "https://hooks.attacker.example/collect",
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1/hook",
    "http://localhost:5432/",
  ])("refuses to store destination %s", async (apiEndpoint) => {
    signIn();
    await expect(save({ data: { ...base, apiEndpoint } })).rejects.toBeInstanceOf(Error);
    expect(mocks.state.writes).toHaveLength(0);
  });

  it("refuses a foreign siteUrl", async () => {
    signIn();
    await expect(
      save({
        data: { ...base, siteUrl: "victim.example", apiEndpoint: "https://moj-web.sk/hook" },
      }),
    ).rejects.toMatchObject({ code: "DESTINATION_NOT_VERIFIED" });
    expect(mocks.state.writes).toHaveLength(0);
    expect(lastStatus()).toBe(403);
  });

  it("maps save errors to 400 / 503 HTTP statuses", async () => {
    signIn();
    await expect(
      save({ data: { ...base, apiEndpoint: "http://169.254.169.254/latest/meta-data/" } }),
    ).rejects.toMatchObject({ code: "UNSAFE_URL" });
    expect(lastStatus()).toBe(400);
    mocks.state.gscFails = true;
    await expect(
      save({ data: { ...base, apiEndpoint: "https://moj-web.sk/hook" } }),
    ).rejects.toMatchObject({ code: "VERIFICATION_UNAVAILABLE" });
    expect(lastStatus()).toBe(503);
    expect(mocks.state.writes).toHaveLength(0);
  });

  it("rate limits saves per user (429) and writes nothing past the limit", async () => {
    signIn();
    for (let i = 0; i < 10; i++) {
      await save({ data: { ...base, apiEndpoint: "https://moj-web.sk/hook" } });
    }
    expect(mocks.state.writes).toHaveLength(10);
    await expect(
      save({ data: { ...base, apiEndpoint: "https://moj-web.sk/hook" } }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(mocks.state.writes).toHaveLength(10);
    expect(lastStatus()).toBe(429);
  });

  it("rejects unauthenticated callers", async () => {
    await expect(
      save({ data: { ...base, apiEndpoint: "https://moj-web.sk/hook" } }),
    ).rejects.toThrow(/Unauthorized/);
    expect(mocks.state.writes).toHaveLength(0);
  });
});

describe("testConnectionBeforeSave destination guard", () => {
  it("does not contact a foreign or internal endpoint", async () => {
    signIn();
    for (const apiEndpoint of [
      "https://attacker.example/wp-json/wp/v2/posts",
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      await expect(
        testBeforeSave({ data: { apiEndpoint, credentials: "u:p" } }),
      ).resolves.toMatchObject({ ok: false });
    }
    expect(mocks.testWordPressConnection).not.toHaveBeenCalled();
    expect(lastStatus()).toBe(400);
  });

  it("answers 403 for an unverified endpoint and 503 when verification is down", async () => {
    signIn();
    await testBeforeSave({
      data: { apiEndpoint: "https://attacker.example/wp-json/wp/v2/posts", credentials: "u:p" },
    });
    expect(lastStatus()).toBe(403);
    mocks.state.gscFails = true;
    await testBeforeSave({
      data: { apiEndpoint: "https://moj-web.sk/wp-json/wp/v2/posts", credentials: "u:p" },
    });
    expect(lastStatus()).toBe(503);
    expect(mocks.testWordPressConnection).not.toHaveBeenCalled();
  });

  it("rate limits connection tests per user (429)", async () => {
    signIn();
    const input = {
      data: { apiEndpoint: "https://moj-web.sk/wp-json/wp/v2/posts", credentials: "u:p" },
    };
    for (let i = 0; i < 10; i++) await testBeforeSave(input);
    expect(mocks.testWordPressConnection).toHaveBeenCalledTimes(10);
    await expect(testBeforeSave(input)).resolves.toMatchObject({ ok: false });
    expect(mocks.testWordPressConnection).toHaveBeenCalledTimes(10);
    expect(lastStatus()).toBe(429);
  });

  it("tests a verified endpoint", async () => {
    signIn();
    await expect(
      testBeforeSave({
        data: { apiEndpoint: "https://moj-web.sk/wp-json/wp/v2/posts", credentials: "u:p" },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.testWordPressConnection).toHaveBeenCalledTimes(1);
  });
});
