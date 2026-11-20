import { describe, expect, it, vi } from "vitest";
import {
  buildDecayAlertEmailHtml,
  escapeHtml,
  resolveVerifiedAlertRecipients,
} from "./decay-alerts.server";

type Lookup = Parameters<typeof resolveVerifiedAlertRecipients>[0];

function adminWith(
  users: Record<string, { email?: string | null; email_confirmed_at?: string | null } | Error>,
): Lookup {
  return {
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => {
          const u = users[id];
          if (u instanceof Error) throw u;
          if (!u) return { data: { user: null }, error: { message: "not found" } };
          return { data: { user: u }, error: null };
        }),
      },
    },
  };
}

describe("resolveVerifiedAlertRecipients", () => {
  it("uses only verified auth e-mails and never a user-editable profile address", async () => {
    const admin = adminWith({
      a: { email: "owner-a@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" },
      b: { email: "unverified@example.com", email_confirmed_at: null },
      c: { email: null, email_confirmed_at: "2026-01-01T00:00:00Z" },
      d: new Error("auth api down"),
    });
    const map = await resolveVerifiedAlertRecipients(admin, ["a", "b", "c", "d", "missing"]);
    expect([...map.entries()]).toEqual([["a", "owner-a@example.com"]]);
  });
});

describe("decay alert HTML escaping", () => {
  it("escapes snapshot-controlled URLs and domain", () => {
    const html = buildDecayAlertEmailHtml({
      domain: '<img src=x onerror="alert(1)">',
      siteUrl: "https://moj-web.sk",
      droppedPages: [
        {
          url: 'https://moj-web.sk/<a href="https://phish.example">Klikni</a>',
          clicksPrev: 10,
          clicksNow: 1,
          lossPct: 90,
          deltaClicks: -9,
        },
      ],
      dashboardUrl: "https://seo.vorkei.com/dashboard?client=x",
    });
    expect(html).not.toContain('<a href="https://phish.example">');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;a href=&quot;https://phish.example&quot;&gt;");
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
