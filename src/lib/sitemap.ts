import { LOCALES, pageUrl, type Locale } from "@/lib/i18n";

export const SITEMAP_PATHS = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/audit", changefreq: "weekly", priority: "0.9" },
  { path: "/brief", changefreq: "monthly", priority: "0.8" },
  { path: "/plan", changefreq: "monthly", priority: "0.8" },
  { path: "/raketa", changefreq: "weekly", priority: "0.9" },
  { path: "/decay", changefreq: "weekly", priority: "0.8" },
] as const;

function alternates(path: string) {
  const links = [
    ...LOCALES.map(
      (locale) =>
        `    <xhtml:link rel="alternate" hreflang="${locale}" href="${pageUrl(locale, path)}"/>`,
    ),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl("sk", path)}"/>`,
  ];
  return links.join("\n");
}

export function buildSitemapXml(lastMod: string) {
  const urls = LOCALES.flatMap((locale) =>
    SITEMAP_PATHS.map((entry) => {
      const loc = pageUrl(locale as Locale, entry.path);
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
${alternates(entry.path)}
  </url>`;
    }),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}
