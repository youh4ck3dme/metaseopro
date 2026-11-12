import { BRAND, isLocale, OG_IMAGE, pageUrl, SITE, t, LOCALES, type Locale } from "@/lib/i18n";

type CopyKey = Parameters<typeof t>[1];

const OG_LOCALE: Record<Locale, string> = {
  sk: "sk_SK",
  en: "en_US",
  de: "de_DE",
};

function localeOf(value: string | undefined): Locale {
  return isLocale(value) ? value : "sk";
}

function jsonLd(description: string, canonical: string) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: BRAND,
        url: SITE,
        logo: `${SITE}/icon-512.png`,
      },
      {
        "@type": "WebApplication",
        name: BRAND,
        url: canonical,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: [...LOCALES],
        description,
        offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      },
    ],
  }).replace(/</g, "\\u003c");
}

export function publicSeoHead(
  locale: string | undefined,
  path: string,
  titleKey: CopyKey,
  descKey: CopyKey,
) {
  const loc = localeOf(locale);
  const title = t(loc, titleKey);
  const description = t(loc, descKey);
  const canonical = pageUrl(loc, path);

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonical },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: OG_LOCALE[loc] },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      { rel: "canonical", href: canonical },
      ...LOCALES.map((item) => ({
        rel: "alternate" as const,
        hrefLang: item,
        href: pageUrl(item, path),
      })),
      { rel: "alternate" as const, hrefLang: "x-default", href: pageUrl("sk", path) },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: jsonLd(description, canonical),
      },
    ],
  };
}

export function privateSeoHead(
  locale: string | undefined,
  path: string,
  titleKey: CopyKey,
  descKey: CopyKey,
) {
  const head = publicSeoHead(locale, path, titleKey, descKey);
  return {
    meta: head.meta.map((item) =>
      "name" in item && item.name === "robots"
        ? { name: "robots", content: "noindex, nofollow" }
        : item,
    ),
    links: head.links,
  };
}
