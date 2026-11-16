import Stripe from "stripe";
import { reconcileStripeEvent, StripeReconciliationError } from "./stripe-reconciliation.server";

export const STRIPE_WEBHOOK_MAX_BYTES = 64 * 1024;

class WebhookBodyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export async function readStripeWebhookBody(request: Request): Promise<string> {
  const announced = Number(request.headers.get("content-length") ?? "0");
  if (announced > STRIPE_WEBHOOK_MAX_BYTES) throw new WebhookBodyError(413, "PAYLOAD_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > STRIPE_WEBHOOK_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WebhookBodyError(413, "PAYLOAD_TOO_LARGE");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    // Preserve valid UTF-8 bytes exactly (including a BOM). No JSON reserialization before verification.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new WebhookBodyError(400, "INVALID_UTF8_BODY");
  }
}

function json(status: number, body: Record<string, unknown>, retry = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(retry ? { "Retry-After": "5" } : {}) },
  });
}

export async function handleStripeWebhook(
  request: Request,
  dependencies: {
    stripe: Stripe | null;
    webhookSecret: string | undefined;
    processEvent?: typeof reconcileStripeEvent;
  },
): Promise<Response> {
  if (!dependencies.stripe || !dependencies.webhookSecret) {
    return json(503, { error: "BILLING_WEBHOOK_NOT_CONFIGURED" }, true);
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return json(400, { error: "MISSING_STRIPE_SIGNATURE" });
  let raw: string;
  try {
    raw = await readStripeWebhookBody(request);
  } catch (error) {
    return error instanceof WebhookBodyError
      ? json(error.status, { error: error.code })
      : json(400, { error: "INVALID_WEBHOOK_BODY" });
  }
  let event: Stripe.Event;
  try {
    event = await dependencies.stripe.webhooks.constructEventAsync(
      raw,
      signature,
      dependencies.webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json(400, { error: "INVALID_STRIPE_SIGNATURE" });
  }
  try {
    const outcome = await (dependencies.processEvent ?? reconcileStripeEvent)(
      event,
      dependencies.stripe,
    );
    return json(200, { received: true, outcome });
  } catch (error) {
    const code =
      error instanceof StripeReconciliationError ? error.code : "BILLING_PROCESSING_FAILED";
    console.error("Stripe reconciliation failed:", code);
    return json(503, { error: code }, true);
  }
}
