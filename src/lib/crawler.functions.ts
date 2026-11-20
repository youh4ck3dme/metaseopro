import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_PAGE_LIMIT, runCrawlForUser } from "./crawler.server";

export const CrawlInputSchema = z.object({
  url: z.string().min(1).max(2048),
  pageLimit: z.number().int().min(1).max(DEFAULT_PAGE_LIMIT).optional(),
});

/**
 * Multipage SEO crawl for the signed-in user. Auth comes from the repo's
 * requireSupabaseAuth middleware (Bearer token); rate limit and concurrency
 * limit are applied per user in runCrawlForUser.
 */
export const crawlSiteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CrawlInputSchema.parse(input))
  .handler(async ({ data, context }) => runCrawlForUser(context.userId, data));
