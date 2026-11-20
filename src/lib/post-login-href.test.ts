import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

// Why login.tsx navigates with `href`: a stored "/audit?domain=a.sk" must keep its query in
// `search`. With `to`, TanStack puts the whole string into the pathname (Bora P2-1).
const buildRouter = () => {
  const root = createRootRoute();
  const audit = createRoute({
    getParentRoute: () => root,
    path: "/audit",
    validateSearch: (search: Record<string, unknown>) => ({
      domain: typeof search.domain === "string" ? search.domain : undefined,
    }),
  });
  return createRouter({
    routeTree: root.addChildren([audit]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
};

describe("post-login navigation target", () => {
  it("href keeps the query in search and the pathname clean", () => {
    const location = buildRouter().buildLocation({ href: "/audit?domain=a.sk" } as never);
    expect(location.pathname).toBe("/audit");
    expect(location.search).toEqual({ domain: "a.sk" });
  });
});
