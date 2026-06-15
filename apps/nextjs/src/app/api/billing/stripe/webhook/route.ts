import { handleStripeWebhook } from "@agentscope/api";

export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const signature = request.headers.get("stripe-signature");
    const event = await handleStripeWebhook({ payload, signature });

    return Response.json({ received: true, type: event.type });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Stripe webhook processing failed.",
      },
      { status: 400 },
    );
  }
}
