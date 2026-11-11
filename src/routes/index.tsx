import { createFileRoute, redirect } from "@tanstack/react-router";
import { localeFromNavigator, readLocaleCookie } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const locale =
      typeof document === "undefined"
        ? "sk"
        : (readLocaleCookie() ?? localeFromNavigator());
    throw redirect({ to: "/$locale", params: { locale } });
  },
});
