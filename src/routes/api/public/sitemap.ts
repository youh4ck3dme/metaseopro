import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://seo.vorkei.com";

const PUBLIC_ROUTES = [
  { path: "", changefreq: "weekly", priority: "1.0" },
  { path: "/audit", changefreq: "weekly", priority: "0.9" },
  { path: "/plan", changefreq: "monthly", priority: "0.8" },
  { path: "/brief", changefreq: "monthly", priority: "0.8" },
  { path: "/raketa", changefreq: "weekly", priority: "0.9" },
  { path: "/decay", changefreq: "daily", priority: "0.9" },
  { path: "/login", changefreq: "monthly", priority: "0.5" },
];

export const Route = createFileRoute("/api/public/sitemap")({
  server: {
    handlers: {
      GET: async () => {
        const lastMod = new Date().toISOString().split("T")[0];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PUBLIC_ROUTES.map(
  (r) => `  <url>
    <loc>${BASE_URL}${r.path}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`,
).join("\n")}
</urlset>`.trim();

        return new Response(xml, {
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
