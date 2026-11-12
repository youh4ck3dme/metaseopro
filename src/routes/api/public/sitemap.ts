import { createFileRoute } from "@tanstack/react-router";
import { buildSitemapXml } from "@/lib/sitemap";

export const Route = createFileRoute("/api/public/sitemap")({
  server: {
    handlers: {
      GET: async () => {
        const lastMod = new Date().toISOString().split("T")[0];
        return new Response(buildSitemapXml(lastMod), {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
          },
        });
      },
    },
  },
});
