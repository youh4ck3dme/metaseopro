import { describe, it, expect, vi } from "vitest";
import {
  detectDroppedPages,
  buildDecayAlertEmailHtml,
  sendDecayAlertEmail,
} from "./decay-alerts.server";

describe("Decay Alerting Engine", () => {
  describe("detectDroppedPages", () => {
    it("detects pages with >25% click loss", () => {
      const rawData = {
        rows: [
          { url: "https://web.sk/sluzba-a", clicksPrev: 100, clicksNow: 70 }, // 30% drop -> ALERT
          { url: "https://web.sk/sluzba-b", clicksPrev: 100, clicksNow: 80 }, // 20% drop -> NO ALERT (<25%)
          { url: "https://web.sk/sluzba-c", clicksPrev: 200, clicksNow: 50 }, // 75% drop -> ALERT
          { url: "https://web.sk/kontakt", clicksPrev: 3, clicksNow: 0 }, // Low baseline (<5) -> IGNORE
        ],
      };

      const dropped = detectDroppedPages(rawData, 25);
      expect(dropped).toHaveLength(2);
      expect(dropped[0]?.url).toBe("https://web.sk/sluzba-c"); // worst loss: -150
      expect(dropped[0]?.lossPct).toBe(75);
      expect(dropped[1]?.url).toBe("https://web.sk/sluzba-a"); // -30
      expect(dropped[1]?.lossPct).toBe(30);
    });

    it("returns empty array for invalid or empty datasets", () => {
      expect(detectDroppedPages(null)).toEqual([]);
      expect(detectDroppedPages({})).toEqual([]);
      expect(detectDroppedPages({ rows: [] })).toEqual([]);
    });
  });

  describe("buildDecayAlertEmailHtml", () => {
    it("renders valid HTML email containing domain and dropped URL table", () => {
      const html = buildDecayAlertEmailHtml({
        domain: "moj-eshop.sk",
        siteUrl: "https://moj-eshop.sk",
        droppedPages: [
          {
            url: "https://moj-eshop.sk/kategoria/topanky",
            clicksPrev: 150,
            clicksNow: 80,
            lossPct: 47,
            deltaClicks: -70,
          },
        ],
        dashboardUrl: "https://seo.vorkei.com/dashboard?client=moj-eshop.sk",
      });

      expect(html).toContain("moj-eshop.sk");
      expect(html).toContain("/kategoria/topanky");
      expect(html).toContain("-47%");
      expect(html).toContain("-70");
      expect(html).toContain("https://seo.vorkei.com/dashboard?client=moj-eshop.sk");
    });
  });

  describe("sendDecayAlertEmail", () => {
    it("simulates email delivery when RESEND_API_KEY is not set", async () => {
      const origKey = process.env.RESEND_API_KEY;
      delete process.env.RESEND_API_KEY;

      const res = await sendDecayAlertEmail({
        toEmail: "klient@eshop.sk",
        domain: "eshop.sk",
        siteUrl: "https://eshop.sk",
        droppedPages: [
          {
            url: "https://eshop.sk/produkt",
            clicksPrev: 50,
            clicksNow: 20,
            lossPct: 60,
            deltaClicks: -30,
          },
        ],
      });

      expect(res.ok).toBe(true);
      expect(res.simulated).toBe(true);

      if (origKey) process.env.RESEND_API_KEY = origKey;
    });

    it("sends request to Resend API when RESEND_API_KEY is configured", async () => {
      process.env.RESEND_API_KEY = "re_test_123456789";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "msg_resend_987" }),
      });

      const res = await sendDecayAlertEmail({
        toEmail: "klient@eshop.sk",
        domain: "eshop.sk",
        siteUrl: "https://eshop.sk",
        droppedPages: [
          {
            url: "https://eshop.sk/produkt",
            clicksPrev: 50,
            clicksNow: 20,
            lossPct: 60,
            deltaClicks: -30,
          },
        ],
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(res.ok).toBe(true);
      expect(res.messageId).toBe("msg_resend_987");
      expect(mockFetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.any(Object));

      delete process.env.RESEND_API_KEY;
    });
  });
});
