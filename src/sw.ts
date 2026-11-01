/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";

const serviceWorker = globalThis as unknown as ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

serviceWorker.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
// Workbox replaces this marker with the generated precache manifest.
// @ts-expect-error __WB_MANIFEST is injected by vite-plugin-pwa at build time.
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ request }) =>
    request.method === "GET" &&
    request.destination !== "document" &&
    request.destination !== "" &&
    request.url.startsWith(self.location.origin),
  new StaleWhileRevalidate({ cacheName: "pismo-static-assets" }),
);

registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/api/"),
  new NetworkFirst({ cacheName: "pismo-api", networkTimeoutSeconds: 8 }),
);

serviceWorker.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") serviceWorker.skipWaiting();
});
