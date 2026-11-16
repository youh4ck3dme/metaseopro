import { DEFAULT_APP_ORIGIN } from "./safe-auth-redirect";

export function resolveBillingOrigin(
  siteUrl: string | undefined = process.env.SITE_URL,
  environment: string | undefined = process.env.NODE_ENV,
): string {
  const value = siteUrl?.trim() || DEFAULT_APP_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SITE_URL nemá platný formát.");
  }
  const localDevelopment =
    environment !== "production" &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !localDevelopment) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new Error("SITE_URL musí byť dôveryhodný origin aplikácie bez cesty alebo parametrov.");
  }
  return parsed.origin;
}

export function resolveBillingReturnUrl(
  candidate: string | undefined,
  fallback: string,
  origin: string = resolveBillingOrigin(),
): string {
  const value = candidate === undefined ? fallback : candidate;
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value !== value.trim() ||
    value.includes("\\") ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    ) ||
    value.length > 2048
  ) {
    throw new Error("Návratová URL musí byť relatívna cesta v SEO4WEB.");
  }
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password) {
    throw new Error("Návratová URL musí zostať na dôveryhodnom origine SEO4WEB.");
  }
  return url.toString();
}
