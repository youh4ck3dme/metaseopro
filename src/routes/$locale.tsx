import { createFileRoute, Outlet, notFound, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { isLocale, pageUrl, t, type Locale } from "@/lib/i18n";

export const Route = createFileRoute("/$locale")({
  beforeLoad: ({ params }) => {
    if (!isLocale(params.locale)) throw notFound();
  },
  head: ({ params }) => {
    const locale = params.locale as Locale;
    return {
      links: [
        { rel: "alternate", hrefLang: "sk", href: pageUrl("sk", "/") },
        { rel: "alternate", hrefLang: "en", href: pageUrl("en", "/") },
        { rel: "alternate", hrefLang: "de", href: pageUrl("de", "/") },
        { rel: "alternate", hrefLang: "x-default", href: pageUrl("sk", "/") },
      ],
      meta: [{ name: "description", content: t(locale, "meta.homeDesc") }],
    };
  },
  component: LocaleLayout,
});

function LocaleLayout() {
  const { locale } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (isLocale(locale)) document.documentElement.lang = locale;
  }, [locale]);

  const rest = pathname.replace(/^\/(sk|en|de)/, "") || "/";

  return (
    <>
      <LocaleHead locale={locale as Locale} path={rest} />
      <Outlet />
    </>
  );
}

function LocaleHead({ locale, path }: { locale: Locale; path: string }) {
  useEffect(() => {
    const head = document.head;
    const wanted = [
      ["sk", pageUrl("sk", path)],
      ["en", pageUrl("en", path)],
      ["de", pageUrl("de", path)],
      ["x-default", pageUrl("sk", path)],
    ] as const;
    for (const [lang, href] of wanted) {
      let el = head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
      if (!el) {
        el = document.createElement("link");
        el.setAttribute("rel", "alternate");
        el.setAttribute("hreflang", lang);
        head.appendChild(el);
      }
      el.setAttribute("href", href);
    }
  }, [locale, path]);
  return null;
}