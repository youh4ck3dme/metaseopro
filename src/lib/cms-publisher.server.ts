// 1-Click CMS Connector for WordPress REST API and Custom Webhooks
// Supports Yoast SEO, Rank Math and Core meta fields.

export type CmsPlatform = "wordpress" | "webflow" | "custom_webhook";
export type SeoPlugin = "yoast" | "rank_math" | "core";
export type PublishStatus = "draft" | "publish" | "future" | "pending";

export interface WordPressPublishParams {
  siteUrl?: string;
  apiEndpoint: string;
  credentials: string; // "username:application_password" or "Bearer <token>"
  seoPlugin?: SeoPlugin;
  postIdOrSlug?: number | string;
  title?: string;
  metaDescription?: string;
  content?: string;
  status?: PublishStatus;
  fetchFn?: typeof fetch;
}

export interface WebhookPublishParams {
  webhookUrl: string;
  bearerToken?: string;
  siteUrl?: string;
  targetUrl?: string;
  title?: string;
  metaDescription?: string;
  content?: string;
  status?: PublishStatus;
  fetchFn?: typeof fetch;
}

export interface PublishResult {
  success: boolean;
  action: "created" | "updated" | "webhook_delivered";
  postId?: number;
  postUrl?: string;
  editUrl?: string;
  status: string;
  error?: string;
  details?: Record<string, string | number | boolean | null>;
}

import { assertSafePublicUrl } from "./safe-url";
export { assertSafePublicUrl };

/**
 * Extracts a clean post slug from a full URL or path.
 * e.g. "https://example.sk/blog/ako-zacat-behat/" -> "ako-zacat-behat"
 */
export function extractSlugFromUrl(urlOrSlug: string): string {
  if (!urlOrSlug) return "";
  let path = urlOrSlug.trim();
  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      const parsed = new URL(path);
      path = parsed.pathname;
    }
  } catch {
    // keep as is
  }
  path = path.replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1]! : "";
}

/**
 * Normalizes a WordPress site URL or partial endpoint to the full REST API endpoint.
 * e.g. "https://mojweb.sk" -> "https://mojweb.sk/wp-json/wp/v2/posts"
 */
export function normalizeWordPressEndpoint(inputUrlOrEndpoint: string): string {
  let url = inputUrlOrEndpoint.trim().replace(/\/+$/, "");
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  if (!url.includes("/wp-json")) {
    url = `${url}/wp-json/wp/v2/posts`;
  }
  return url;
}

/**
 * Formats WordPress authorization header.
 * Supports WordPress Application Passwords ("username:password") with Basic Auth,
 * or raw Bearer tokens.
 */
export function formatWordPressAuthHeader(credentials: string): string {
  const trimmed = credentials.trim();
  if (trimmed.startsWith("Basic ") || trimmed.startsWith("Bearer ")) {
    return trimmed;
  }
  if (trimmed.includes(":")) {
    const b64 =
      typeof Buffer !== "undefined"
        ? Buffer.from(trimmed).toString("base64")
        : btoa(unescape(encodeURIComponent(trimmed)));
    return `Basic ${b64}`;
  }
  return `Bearer ${trimmed}`;
}

/**
 * Builds the WordPress REST API post payload with SEO plugin metadata.
 */
export function buildWordPressPayload(params: {
  title?: string;
  metaDescription?: string;
  content?: string;
  status?: PublishStatus;
  slug?: string;
  seoPlugin?: SeoPlugin;
}): Record<string, unknown> {
  const { title, metaDescription, content, status = "draft", slug, seoPlugin = "yoast" } = params;
  const payload: Record<string, unknown> = {
    status,
  };

  if (title !== undefined) {
    payload.title = title;
  }

  if (content !== undefined) {
    payload.content = content;
  }

  if (slug) {
    payload.slug = slug;
  }

  const meta: Record<string, unknown> = {};

  if (seoPlugin === "yoast") {
    if (title !== undefined) {
      meta._yoast_wpseo_title = title;
    }
    if (metaDescription !== undefined) {
      meta._yoast_wpseo_metadesc = metaDescription;
    }
  } else if (seoPlugin === "rank_math") {
    if (title !== undefined) {
      meta.rank_math_title = title;
    }
    if (metaDescription !== undefined) {
      meta.rank_math_description = metaDescription;
    }
  }

  if (Object.keys(meta).length > 0) {
    payload.meta = meta;
  }

  // If using core or if metaDescription is provided, also set WP excerpt as fallback
  if (metaDescription !== undefined) {
    payload.excerpt = metaDescription;
  }

  return payload;
}

/**
 * Publishes or updates a post / page on WordPress via the WP REST API v2.
 */
export async function publishToWordPress(params: WordPressPublishParams): Promise<PublishResult> {
  const {
    siteUrl,
    apiEndpoint,
    credentials,
    seoPlugin = "yoast",
    postIdOrSlug,
    title,
    metaDescription,
    content,
    status = "draft",
    fetchFn = fetch,
  } = params;

  try {
    if (siteUrl) assertSafePublicUrl(siteUrl);
    if (apiEndpoint) assertSafePublicUrl(apiEndpoint);
  } catch (err) {
    return {
      success: false,
      action: "updated",
      status: "error",
      error: err instanceof Error ? err.message : "Neplatná alebo nepovolená URL adresa.",
    };
  }

  const endpoint = normalizeWordPressEndpoint(apiEndpoint);
  const authHeader = formatWordPressAuthHeader(credentials);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authHeader,
    Accept: "application/json",
  };

  // Determine if postIdOrSlug is a numeric ID or a slug
  let targetPostId: number | null = null;
  let targetSlug = "";

  if (typeof postIdOrSlug === "number") {
    targetPostId = postIdOrSlug;
  } else if (typeof postIdOrSlug === "string" && postIdOrSlug.trim()) {
    const raw = postIdOrSlug.trim();
    if (/^\d+$/.test(raw)) {
      targetPostId = parseInt(raw, 10);
    } else {
      targetSlug = extractSlugFromUrl(raw);
    }
  }

  try {
    // 1. If we have a slug but no ID, query WP REST API to check if post already exists
    if (!targetPostId && targetSlug) {
      try {
        const queryUrl = `${endpoint}?slug=${encodeURIComponent(targetSlug)}&status=any`;
        const searchRes = await fetchFn(queryUrl, { method: "GET", headers });
        if (searchRes.ok) {
          const posts = (await searchRes.json()) as Array<{ id: number }>;
          if (Array.isArray(posts) && posts.length > 0 && posts[0]?.id) {
            targetPostId = posts[0].id;
          }
        }
      } catch (e) {
        console.warn("[CMS Publisher] Failed to search post by slug, falling back to create:", e);
      }
    }

    // 2. Build payload
    const payload = buildWordPressPayload({
      title,
      metaDescription,
      content,
      status,
      slug: targetSlug || undefined,
      seoPlugin,
    });

    // 3. Make POST request (update if ID known, create if not)
    const requestUrl = targetPostId ? `${endpoint}/${targetPostId}` : endpoint;
    const action: "created" | "updated" = targetPostId ? "updated" : "created";

    const response = await fetchFn(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = `WordPress REST API chyba (${response.status})`;
      try {
        const errJson = (await response.json()) as { message?: string; code?: string };
        if (errJson?.message) {
          errorMessage = errJson.message.replace(/<[^>]*>?/gm, ""); // strip HTML
        }
      } catch {
        const errText = await response.text().catch(() => "");
        if (errText) errorMessage = errText.slice(0, 200);
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          action,
          status,
          error:
            "Neplatné prihlasovacie údaje alebo WordPress Application Password nemá dostatočné oprávnenia na úpravu príspevkov.",
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          action,
          status,
          error: `WordPress REST API endpoint nebol nájdený (${requestUrl}). Skontrolujte štruktúru permalinkov vo WordPresse.`,
        };
      }

      return {
        success: false,
        action,
        status,
        error: errorMessage,
      };
    }

    const data = (await response.json()) as {
      id?: number;
      link?: string;
      status?: string;
    };

    const postId = data.id || targetPostId || undefined;
    const postUrl = data.link;

    // Construct WordPress admin edit URL if siteUrl is available
    let editUrl: string | undefined;
    if (postId) {
      const baseSiteUrl = siteUrl
        ? siteUrl.replace(/\/+$/, "")
        : endpoint.replace(/\/wp-json\/.*$/, "");
      editUrl = `${baseSiteUrl}/wp-admin/post.php?post=${postId}&action=edit`;
    }

    return {
      success: true,
      action,
      postId,
      postUrl,
      editUrl,
      status: data.status || status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      action: targetPostId ? "updated" : "created",
      status,
      error: `Nepodarilo sa pripojiť k WordPress serveru: ${msg}`,
    };
  }
}

/**
 * Delivers an automated deploy payload to a custom webhook endpoint.
 */
export async function publishToCustomWebhook(params: WebhookPublishParams): Promise<PublishResult> {
  const {
    webhookUrl,
    bearerToken,
    siteUrl,
    targetUrl,
    title,
    metaDescription,
    content,
    status = "publish",
    fetchFn = fetch,
  } = params;

  try {
    assertSafePublicUrl(webhookUrl);
  } catch (err) {
    return {
      success: false,
      action: "webhook_delivered",
      status: "error",
      error: err instanceof Error ? err.message : "Neplatná alebo nepovolená URL adresa webhooku.",
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (bearerToken?.trim()) {
    headers.Authorization = bearerToken.startsWith("Bearer ")
      ? bearerToken
      : `Bearer ${bearerToken.trim()}`;
  }

  const payload = {
    event: "cms.deploy",
    siteUrl: siteUrl || "",
    targetUrl: targetUrl || "",
    slug: targetUrl ? extractSlugFromUrl(targetUrl) : "",
    title: title || "",
    metaDescription: metaDescription || "",
    content: content || "",
    status,
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetchFn(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        success: false,
        action: "webhook_delivered",
        status,
        error: `Webhook server vrátil chybu (${res.status}): ${errText.slice(0, 200)}`,
      };
    }

    return {
      success: true,
      action: "webhook_delivered",
      status,
    };
  } catch (err) {
    return {
      success: false,
      action: "webhook_delivered",
      status,
      error: `Chyba spojenia s webhook serverom: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Tests connection to a WordPress site using Application Passwords.
 */
export async function testWordPressConnection(params: {
  apiEndpoint: string;
  credentials: string;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; message: string; username?: string }> {
  const { apiEndpoint, credentials, fetchFn = fetch } = params;

  try {
    assertSafePublicUrl(apiEndpoint);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Neplatná alebo nepovolená URL adresa.",
    };
  }

  const endpoint = normalizeWordPressEndpoint(apiEndpoint);
  const baseWpJson = endpoint.replace(/\/wp\/v2\/.*$/, "");
  const authHeader = formatWordPressAuthHeader(credentials);

  try {
    // Try requesting /wp/v2/users/me which verifies both REST API and auth credentials
    const meUrl = `${baseWpJson}/wp/v2/users/me`;
    const res = await fetchFn(meUrl, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (res.ok) {
      const user = (await res.json()) as { name?: string; slug?: string };
      const name = user.name || user.slug || "Autor";
      return {
        ok: true,
        message: `Spojenie úspešné! Prihlásený používateľ: ${name}.`,
        username: name,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message:
          "Neplatné prihlasovacie údaje alebo WordPress Application Password. Skontrolujte používateľské meno a vygenerované aplikačné heslo.",
      };
    }

    // Fallback: check if public posts endpoint is at least reachable
    const testPostsRes = await fetchFn(`${endpoint}?per_page=1`, {
      headers: { Authorization: authHeader },
    });
    if (testPostsRes.ok) {
      return {
        ok: true,
        message: "REST API je dostupné, ale profil používateľa /users/me je obmedzený.",
      };
    }

    return {
      ok: false,
      message: `WordPress REST API vrátilo kód ${res.status}. Skontrolujte URL a permalinky.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Chyba pripojenia: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
