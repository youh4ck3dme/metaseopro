import { describe, it, expect, vi } from "vitest";
import {
  extractSlugFromUrl,
  normalizeWordPressEndpoint,
  formatWordPressAuthHeader,
  buildWordPressPayload,
  publishToWordPress,
  publishToCustomWebhook,
  testWordPressConnection,
  assertSafePublicUrl,
} from "./cms-publisher.server";

describe("CMS Publisher & WordPress Connector", () => {
  describe("Slug & Endpoint utilities", () => {
    it("extracts clean slugs from full URLs and relative paths", () => {
      expect(extractSlugFromUrl("https://example.sk/blog/ako-zacat-behat/")).toBe(
        "ako-zacat-behat",
      );
      expect(extractSlugFromUrl("https://example.sk/kategoria/behanie/tenisky-nike")).toBe(
        "tenisky-nike",
      );
      expect(extractSlugFromUrl("/sluzby/seo-audit/")).toBe("seo-audit");
      expect(extractSlugFromUrl("cisty-slug")).toBe("cisty-slug");
      expect(extractSlugFromUrl("")).toBe("");
    });

    it("normalizes WordPress endpoints cleanly", () => {
      expect(normalizeWordPressEndpoint("example.sk")).toBe(
        "https://example.sk/wp-json/wp/v2/posts",
      );
      expect(normalizeWordPressEndpoint("https://mojweb.sk/")).toBe(
        "https://mojweb.sk/wp-json/wp/v2/posts",
      );
      expect(normalizeWordPressEndpoint("https://mojweb.sk/wp-json/wp/v2/posts")).toBe(
        "https://mojweb.sk/wp-json/wp/v2/posts",
      );
    });

    it("formats WordPress Basic and Bearer auth headers correctly", () => {
      const basic = formatWordPressAuthHeader("admin:xxxx-yyyy-zzzz");
      expect(basic.startsWith("Basic ")).toBe(true);

      const existingBasic = formatWordPressAuthHeader("Basic YWRtaW46cGFzcw==");
      expect(existingBasic).toBe("Basic YWRtaW46cGFzcw==");

      const bearer = formatWordPressAuthHeader("Bearer custom_token_123");
      expect(bearer).toBe("Bearer custom_token_123");

      const rawToken = formatWordPressAuthHeader("some_api_token_here");
      expect(rawToken).toBe("Bearer some_api_token_here");
    });
  });

  describe("WordPress Payload Builder", () => {
    it("builds payload with Yoast SEO meta fields", () => {
      const payload = buildWordPressPayload({
        title: "Nový optimalizovaný titulok",
        metaDescription: "Pútavý meta popis pre vyhľadávač.",
        content: "<p>Obsah článku</p>",
        status: "draft",
        slug: "novy-clanok",
        seoPlugin: "yoast",
      });

      expect(payload.title).toBe("Nový optimalizovaný titulok");
      expect(payload.content).toBe("<p>Obsah článku</p>");
      expect(payload.status).toBe("draft");
      expect(payload.slug).toBe("novy-clanok");
      expect(payload.excerpt).toBe("Pútavý meta popis pre vyhľadávač.");
      expect(payload.meta).toEqual({
        _yoast_wpseo_title: "Nový optimalizovaný titulok",
        _yoast_wpseo_metadesc: "Pútavý meta popis pre vyhľadávač.",
      });
    });

    it("builds payload with Rank Math SEO meta fields", () => {
      const payload = buildWordPressPayload({
        title: "Rank Math Titulok",
        metaDescription: "Rank Math Popis",
        seoPlugin: "rank_math",
        status: "publish",
      });

      expect(payload.title).toBe("Rank Math Titulok");
      expect(payload.status).toBe("publish");
      expect(payload.meta).toEqual({
        rank_math_title: "Rank Math Titulok",
        rank_math_description: "Rank Math Popis",
      });
    });

    it("builds payload with Core fallback when no SEO plugin is used", () => {
      const payload = buildWordPressPayload({
        title: "Standard Titulok",
        metaDescription: "Standard Excerpt",
        seoPlugin: "core",
      });

      expect(payload.title).toBe("Standard Titulok");
      expect(payload.excerpt).toBe("Standard Excerpt");
      expect(payload.meta).toBeUndefined();
    });
  });

  describe("WordPress API Execution (Mocked)", () => {
    it("updates existing post by ID successfully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 42,
          link: "https://mojweb.sk/blog/post-42",
          status: "publish",
        }),
      });

      const result = await publishToWordPress({
        siteUrl: "https://mojweb.sk",
        apiEndpoint: "https://mojweb.sk/wp-json/wp/v2/posts",
        credentials: "admin:xxxx-yyyy",
        postIdOrSlug: 42,
        title: "Aktualizovaný článok",
        metaDescription: "Nový meta popis",
        status: "publish",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0]!;
      expect(call[0]).toBe("https://mojweb.sk/wp-json/wp/v2/posts/42");
      expect(call[1]?.method).toBe("POST");

      const sentBody = JSON.parse(call[1]?.body as string);
      expect(sentBody.title).toBe("Aktualizovaný článok");
      expect(sentBody.status).toBe("publish");
      expect(sentBody.meta._yoast_wpseo_title).toBe("Aktualizovaný článok");

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");
      expect(result.postId).toBe(42);
      expect(result.postUrl).toBe("https://mojweb.sk/blog/post-42");
      expect(result.editUrl).toBe("https://mojweb.sk/wp-admin/post.php?post=42&action=edit");
    });

    it("finds post by slug and updates it", async () => {
      const mockFetch = vi
        .fn()
        // First call: GET search by slug
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 108, slug: "moj-stary-clanok" }],
        })
        // Second call: POST update post 108
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 108,
            link: "https://mojweb.sk/moj-stary-clanok",
            status: "draft",
          }),
        });

      const result = await publishToWordPress({
        siteUrl: "https://mojweb.sk",
        apiEndpoint: "https://mojweb.sk",
        credentials: "admin:testpass",
        postIdOrSlug: "https://mojweb.sk/moj-stary-clanok/",
        title: "Vynovený Title",
        metaDescription: "Vynovený meta description",
        status: "draft",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0]![0]).toContain("slug=moj-stary-clanok");
      expect(mockFetch.mock.calls[1]![0]).toBe("https://mojweb.sk/wp-json/wp/v2/posts/108");

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");
      expect(result.postId).toBe(108);
    });

    it("creates a new post when post is not found", async () => {
      const mockFetch = vi
        .fn()
        // Search by slug returns empty array
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        })
        // Create new post returns id 205
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            id: 205,
            link: "https://mojweb.sk/novy-prispevok",
            status: "draft",
          }),
        });

      const result = await publishToWordPress({
        siteUrl: "https://mojweb.sk",
        apiEndpoint: "https://mojweb.sk",
        credentials: "admin:testpass",
        postIdOrSlug: "novy-prispevok",
        title: "Úplne nový príspevok",
        content: "<p>Skvelý obsah</p>",
        status: "draft",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1]![0]).toBe("https://mojweb.sk/wp-json/wp/v2/posts");
      expect(result.success).toBe(true);
      expect(result.action).toBe("created");
      expect(result.postId).toBe(205);
    });

    it("handles 401/403 unauthorized credentials with friendly Slovak message", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          code: "rest_cannot_edit",
          message: "Sorry, you are not allowed to edit this post.",
        }),
      });

      const result = await publishToWordPress({
        apiEndpoint: "https://mojweb.sk/wp-json/wp/v2/posts",
        credentials: "bad_user:bad_pass",
        postIdOrSlug: 99,
        title: "Test",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Neplatné prihlasovacie údaje alebo WordPress Application Password",
      );
    });

    it("handles 404 not found cleanly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: "Not found" }),
      });

      const result = await publishToWordPress({
        apiEndpoint: "https://mojweb.sk/non-existent-api",
        credentials: "user:pass",
        postIdOrSlug: 99,
        title: "Test",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("WordPress REST API endpoint nebol nájdený");
    });

    it("handles network connection exceptions gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ENOTFOUND mojweb.sk"));

      const result = await publishToWordPress({
        apiEndpoint: "https://mojweb.sk/wp-json/wp/v2/posts",
        credentials: "user:pass",
        postIdOrSlug: 99,
        title: "Test",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Nepodarilo sa pripojiť k WordPress serveru");
    });
  });

  describe("Custom Webhook Publisher", () => {
    it("delivers payload to webhook endpoint with bearer token", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "OK",
      });

      const result = await publishToCustomWebhook({
        webhookUrl: "https://webhook.site/my-hook",
        bearerToken: "secret_webhook_token_777",
        siteUrl: "https://mysite.com",
        targetUrl: "https://mysite.com/blog/article",
        title: "Nový článok cez webhook",
        metaDescription: "Meta popis pre webhook",
        status: "publish",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0]!;
      expect(call[0]).toBe("https://webhook.site/my-hook");
      expect(call[1]?.headers).toEqual({
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer secret_webhook_token_777",
      });

      const body = JSON.parse(call[1]?.body as string);
      expect(body.event).toBe("cms.deploy");
      expect(body.title).toBe("Nový článok cez webhook");
      expect(body.slug).toBe("article");

      expect(result.success).toBe(true);
      expect(result.action).toBe("webhook_delivered");
    });
  });

  describe("Connection Testing", () => {
    it("validates credentials via /users/me", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ name: "Erik Šéfredaktor" }),
      });

      const res = await testWordPressConnection({
        apiEndpoint: "https://mojweb.sk",
        credentials: "erik:app_pass_123",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(res.ok).toBe(true);
      expect(res.username).toBe("Erik Šéfredaktor");
      expect(res.message).toContain("Erik Šéfredaktor");
    });

    it("returns clear message on invalid credentials", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const res = await testWordPressConnection({
        apiEndpoint: "https://mojweb.sk",
        credentials: "erik:zle_heslo",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(res.ok).toBe(false);
      expect(res.message).toContain("Neplatné prihlasovacie údaje");
    });
    describe("SSRF Security & URL Validation", () => {
      it("blocks localhost, loopback and private networks", () => {
        expect(() => assertSafePublicUrl("http://localhost/wp-json")).toThrow(/lokálne adresy/);
        expect(() => assertSafePublicUrl("http://127.0.0.1:8080/wp-json")).toThrow(/loopback IP/);
        expect(() => assertSafePublicUrl("http://169.254.169.254/meta-data")).toThrow(
          /metadata service/,
        );
        expect(() => assertSafePublicUrl("http://10.1.2.3/api")).toThrow(/privátna sieť/);
        expect(() => assertSafePublicUrl("http://192.168.1.100/posts")).toThrow(/privátna sieť/);
        expect(() => assertSafePublicUrl("http://172.20.0.5/api")).toThrow(/privátna sieť/);
        expect(() => assertSafePublicUrl("ftp://example.com/api")).toThrow(/protokoly http/);
      });

      it("allows valid public web URLs", () => {
        expect(() => assertSafePublicUrl("https://mojweb.sk")).not.toThrow();
        expect(() =>
          assertSafePublicUrl("https://blog.firma.cz/wp-json/wp/v2/posts"),
        ).not.toThrow();
      });

      it("rejects publishToWordPress when target URL is private", async () => {
        const res = await publishToWordPress({
          siteUrl: "http://127.0.0.1",
          apiEndpoint: "http://127.0.0.1/wp-json",
          credentials: "user:pass",
          title: "Test",
        });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Nepovolená sieťová adresa/);
      });
    });
  });
});
