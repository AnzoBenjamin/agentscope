import { createLogger } from "@agentscope/observability";

import { handleStripeWebhook } from "@agentscope/api";

const logger = createLogger("billing.stripe-webhook");

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const signature = request.headers.get("stripe-signature");
    const event = await handleStripeWebhook({ payload, signature });

    return Response.json({ received: true, type: event.type });
  } catch (error) {
    // Don't return the raw error message to the caller. Stripe webhooks
    // are signed; an attacker probing for a valid signature shouldn't be
    // able to enumerate which validation step failed ("Invalid Stripe
    // signature header." vs "Stripe signature verification failed." vs
    // the underlying HMAC error), and we don't want to leak any future
    // stack traces if `handleStripeWebhook` starts throwing differently.
    // The Stripe dashboard surfaces a 4xx with a generic body correctly
    // — it only cares about the response status, not the body.
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: message }, "stripe webhook processing failed");
    return Response.json(
      { error: "Stripe webhook processing failed." },
      { status: 400 },
    );
  }
}
