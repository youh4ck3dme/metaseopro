import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  publishToWordPress,
  publishToCustomWebhook,
  testWordPressConnection,
  type CmsPlatform,
  type SeoPlugin,
  type PublishStatus,
  type PublishResult,
} from "./cms-publisher.server";

const CmsConnectionSchema = z.object({
  id: z.string().uuid().optional(),
  siteUrl: z.string().trim().min(1, "Zadajte platnú URL webu"),
  platform: z.enum(["wordpress", "webflow", "custom_webhook"]).default("wordpress"),
  apiEndpoint: z.string().trim().min(1, "Zadajte API endpoint"),
  credentials: z.string().trim().min(1, "Zadajte prístupové údaje / token"),
  seoPlugin: z.enum(["yoast", "rank_math", "core"]).default("yoast"),
});

const DeployInputSchema = z.object({
  connectionId: z.string().uuid().optional(),
  siteUrl: z.string().trim().optional(),
  targetUrl: z.string().trim().optional(),
  postIdOrSlug: z.union([z.number(), z.string()]).optional(),
  title: z.string().trim().optional(),
  metaDescription: z.string().trim().optional(),
  content: z.string().trim().optional(),
  status: z.enum(["draft", "publish"]).default("draft"),
});

export interface SafeCmsConnection {
  id: string;
  siteUrl: string;
  platform: CmsPlatform;
  apiEndpoint: string;
  seoPlugin: SeoPlugin;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ConnectionRecord {
  platform: CmsPlatform;
  api_endpoint: string;
  credentials_encrypted: string;
  seo_plugin: SeoPlugin;
  site_url: string;
}

/**
 * Lists all CMS connections belonging to the authenticated user.
 */
export const listUserCmsConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SafeCmsConnection[]> => {
    const { supabase, userId } = context;

    const { data, error } = await supabase
      .from("cms_connections")
      .select(
        "id, site_url, platform, api_endpoint, seo_plugin, credentials_encrypted, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[CMS] Error fetching connections:", error);
      throw new Error("Nepodarilo sa načítať CMS prepojenia.");
    }

    const rows = (data || []) as Array<{
      id: string;
      site_url: string;
      platform: string;
      api_endpoint: string;
      seo_plugin: string;
      credentials_encrypted: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      siteUrl: row.site_url,
      platform: row.platform as CmsPlatform,
      apiEndpoint: row.api_endpoint,
      seoPlugin: row.seo_plugin as SeoPlugin,
      hasCredentials: Boolean(row.credentials_encrypted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });

/**
 * Saves (inserts or updates) a CMS connection for the user.
 */
export const saveUserCmsConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CmsConnectionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const payload = {
      user_id: userId,
      site_url: data.siteUrl.trim(),
      platform: data.platform,
      api_endpoint: data.apiEndpoint.trim(),
      credentials_encrypted: data.credentials.trim(),
      seo_plugin: data.seoPlugin,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await supabase
        .from("cms_connections")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", userId);

      if (error) throw new Error(error.message);
      return { success: true, id: data.id, action: "updated" };
    } else {
      const { data: inserted, error } = await supabase
        .from("cms_connections")
        .insert(payload)
        .select("id")
        .single();

      if (error) throw new Error(error.message);
      return { success: true, id: inserted.id, action: "created" };
    }
  });

/**
 * Deletes a CMS connection.
 */
export const deleteUserCmsConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { error } = await supabase
      .from("cms_connections")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);

    if (error) throw new Error("Nepodarilo sa zmazať CMS pripojenie.");
    return { success: true };
  });

/**
 * Tests connection to a WordPress site before saving.
 */
export const testConnectionBeforeSave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        apiEndpoint: z.string().trim().min(1),
        credentials: z.string().trim().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    return await testWordPressConnection({
      apiEndpoint: data.apiEndpoint,
      credentials: data.credentials,
    });
  });

/**
 * 1-Click Deploy to WordPress or Custom Webhook.
 */
export const deployContentToCms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeployInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<PublishResult> => {
    const { supabase, userId } = context;

    let connection: ConnectionRecord | null = null;

    if (data.connectionId) {
      const { data: conn } = await supabase
        .from("cms_connections")
        .select("platform, api_endpoint, credentials_encrypted, seo_plugin, site_url")
        .eq("id", data.connectionId)
        .eq("user_id", userId)
        .single();
      if (conn) {
        connection = conn as unknown as ConnectionRecord;
      }
    } else if (data.siteUrl) {
      const normalizedSite = data.siteUrl.toLowerCase().trim();
      const { data: conns } = await supabase
        .from("cms_connections")
        .select("platform, api_endpoint, credentials_encrypted, seo_plugin, site_url")
        .eq("user_id", userId);

      if (conns && conns.length > 0) {
        const typedConns = conns as unknown as ConnectionRecord[];
        const found =
          typedConns.find((c) => c.site_url.toLowerCase().trim() === normalizedSite) ||
          typedConns.find((c) =>
            normalizedSite.includes(c.site_url.toLowerCase().replace(/^https?:\/\//, "")),
          ) ||
          typedConns[0];
        if (found) connection = found;
      }
    }

    if (!connection) {
      throw new Error(
        "Nebolo nájdené žiadne CMS pripojenie. Pridajte svoje WordPress stránky v Nastaveniach agentúry -> CMS Integrácie.",
      );
    }

    if (connection.platform === "wordpress") {
      const target = data.postIdOrSlug || data.targetUrl || "";
      const result = await publishToWordPress({
        siteUrl: connection.site_url,
        apiEndpoint: connection.api_endpoint,
        credentials: connection.credentials_encrypted,
        seoPlugin: connection.seo_plugin,
        postIdOrSlug: target,
        title: data.title,
        metaDescription: data.metaDescription,
        content: data.content,
        status: data.status as PublishStatus,
      });

      if (!result.success) {
        throw new Error(result.error || "Publikovanie do WordPress zlyhalo.");
      }

      return result;
    } else if (connection.platform === "custom_webhook") {
      const result = await publishToCustomWebhook({
        webhookUrl: connection.api_endpoint,
        bearerToken: connection.credentials_encrypted,
        siteUrl: connection.site_url,
        targetUrl: data.targetUrl,
        title: data.title,
        metaDescription: data.metaDescription,
        content: data.content,
        status: data.status as PublishStatus,
      });

      if (!result.success) {
        throw new Error(result.error || "Odoslanie na webhook zlyhalo.");
      }

      return result;
    }

    throw new Error(`Platforma ${connection.platform} zatiaľ nie je podporovaná.`);
  });
