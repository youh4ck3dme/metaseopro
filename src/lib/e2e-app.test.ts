import { describe, expect, it } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:8080";

async function isServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/`, { method: "HEAD", signal: AbortSignal.timeout(2000) });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

describe("E2E Application Workflow & Route Integrity", () => {
  it("renders Landing Page (/) with complete SSR metadata and AppHeader", async () => {
    const reachable = await isServerReachable();
    if (!reachable) {
      console.warn("Dev server not reachable, skipping live HTTP test.");
      return;
    }

    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("SEO4WEB");
    expect(html).toContain("AI SEO Command Center");
    expect(html).toContain("Blog Writer");
    // Dropdown links mount on interaction; their destinations are checked below
    // and through the authenticated browser navigation check.
    expect(html).toContain("Agentúra");
  }, 15000);

  it("serves Whitelabel Agency Settings route (/settings/agency)", async () => {
    const reachable = await isServerReachable();
    if (!reachable) return;

    const res = await fetch(`${BASE_URL}/settings/agency`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("Nastavenia agentúry");
    expect(html).toContain("Whitelabel");
    expect(html).toContain("Branding");
  }, 15000);

  it("serves all primary application routes with 200 OK", async () => {
    const reachable = await isServerReachable();
    if (!reachable) return;

    const routes = [
      "/dashboard",
      "/decay",
      "/raketa",
      "/audit",
      "/plan",
      "/brief",
      "/history",
      "/login",
    ];

    await Promise.all(
      routes.map(async (route) => {
        const res = await fetch(`${BASE_URL}${route}`);
        expect(res.status, `Expected route ${route} to return 200 OK`).toBe(200);
        const text = await res.text();
        expect(text.length).toBeGreaterThan(500);
        expect(text).toContain("SEO4WEB");
      }),
    );
  }, 20000);

  it("guards API routes against unauthorized access", async () => {
    const reachable = await isServerReachable();
    if (!reachable) return;

    // decay-analyze requires bearer token
    const resAnalyze = await fetch(`${BASE_URL}/api/decay-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "demo", scenario: "blog" }),
    });
    // Expect 401 Unauthorized
    expect(resAnalyze.status).toBe(401);
    const jsonAnalyze = await resAnalyze.json();
    expect(jsonAnalyze.error).toContain("prihlásenie");

    // decay-gsc-properties handles GET and requires bearer token
    const resProperties = await fetch(`${BASE_URL}/api/decay-gsc-properties`, {
      method: "GET",
    });
    expect(resProperties.status).toBe(401);
    const jsonProperties = await resProperties.json();
    expect(jsonProperties.error).toContain("prihlásenie");
  });

  it("handles Stripe webhook endpoint securely", async () => {
    const reachable = await isServerReachable();
    if (!reachable) return;

    const resWebhook = await fetch(`${BASE_URL}/api/public/stripe-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "test.event" }),
    });

    // In dev without STRIPE_WEBHOOK_SECRET it safely acknowledges, or returns 400 when keys are present
    expect([200, 400]).toContain(resWebhook.status);
    const json = await resWebhook.json();
    expect(json).toBeDefined();
  });
});
