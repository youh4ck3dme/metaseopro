import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  handleStripeWebhook,
  readStripeWebhookBody,
  STRIPE_WEBHOOK_MAX_BYTES,
} from "./stripe-webhook-http.server";
import { StripeReconciliationError } from "./stripe-reconciliation.server";

const stripe = new Stripe("synthetic-api-key-not-used-for-network");
const secret = "synthetic-signing-secret";
const payload =
  '{\n  "id": "evt_fixture", "object": "event", "type": "customer.subscription.updated", "livemode": false, "data": {"object": {"id": "sub_fixture", "customer": "cus_fixture", "metadata": {"note": "Žltý test"}}}\n}';
function request(body = payload, timestamp?: number, signedBody = body): Request {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: signedBody,
    secret,
    timestamp,
  });
  return new Request("https://example.test/api/public/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": signature, "Content-Type": "application/json" },
    body,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Stripe webhook raw bytes and acknowledgement", () => {
  it("returns retryable 503 instead of fake success when config is absent", async () => {
    const processEvent = vi.fn();
    expect(
      (await handleStripeWebhook(request(), { stripe: null, webhookSecret: secret, processEvent }))
        .status,
    ).toBe(503);
    expect(
      (await handleStripeWebhook(request(), { stripe, webhookSecret: undefined, processEvent }))
        .status,
    ).toBe(503);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("requires a signature and rejects a forged one", async () => {
    const processEvent = vi.fn();
    const missing = new Request("https://example.test", { method: "POST", body: payload });
    expect(
      (await handleStripeWebhook(missing, { stripe, webhookSecret: secret, processEvent })).status,
    ).toBe(400);
    const forged = request();
    forged.headers.set("stripe-signature", "t=1,v1=synthetic-invalid");
    expect(
      (await handleStripeWebhook(forged, { stripe, webhookSecret: secret, processEvent })).status,
    ).toBe(400);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("verifies an actual HMAC over the original whitespace and UTF-8 body", async () => {
    const processEvent = vi.fn().mockResolvedValue("processed");
    const response = await handleStripeWebhook(request(), {
      stripe,
      webhookSecret: secret,
      processEvent,
    });
    expect(response.status).toBe(200);
    expect(processEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { object: expect.objectContaining({ metadata: { note: "Žltý test" } }) },
      }),
      stripe,
    );
  });

  it("rejects a body reserialized or altered after signing", async () => {
    const processEvent = vi.fn();
    const response = await handleStripeWebhook(
      request(JSON.stringify(JSON.parse(payload)), undefined, payload),
      { stripe, webhookSecret: secret, processEvent },
    );
    expect(response.status).toBe(400);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("rejects expired HMAC timestamps", async () => {
    const response = await handleStripeWebhook(
      request(payload, Math.floor(Date.now() / 1000) - 600),
      { stripe, webhookSecret: secret, processEvent: vi.fn() },
    );
    expect(response.status).toBe(400);
  });

  it("caps actual UTF-8 bytes even without Content-Length or with a false length", async () => {
    const large = request("🙂".repeat(STRIPE_WEBHOOK_MAX_BYTES / 4 + 1));
    large.headers.set("content-length", "1");
    const processEvent = vi.fn();
    expect(
      (await handleStripeWebhook(large, { stripe, webhookSecret: secret, processEvent })).status,
    ).toBe(413);
    expect(processEvent).not.toHaveBeenCalled();
    await expect(
      readStripeWebhookBody(request("x".repeat(STRIPE_WEBHOOK_MAX_BYTES + 1))),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("rejects invalid UTF-8 before verification", async () => {
    const raw = new Request("https://example.test", {
      method: "POST",
      body: new Uint8Array([255]),
    });
    await expect(readStripeWebhookBody(raw)).rejects.toMatchObject({ status: 400 });
  });

  it("returns 503 and Retry-After on pending/concurrent reconciliation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleStripeWebhook(request(), {
      stripe,
      webhookSecret: secret,
      processEvent: vi.fn().mockRejectedValue(new StripeReconciliationError("BILLING_LEASE_BUSY")),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toEqual({ error: "BILLING_LEASE_BUSY" });
  });

  it("returns 200 only after processEvent confirms a completed duplicate", async () => {
    const response = await handleStripeWebhook(request(), {
      stripe,
      webhookSecret: secret,
      processEvent: vi.fn().mockResolvedValue("duplicate"),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "duplicate" });
  });
});
