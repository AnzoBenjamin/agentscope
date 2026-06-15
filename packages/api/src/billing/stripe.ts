const STRIPE_API_BASE = "https://api.stripe.com/v1";

export function isStripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

export async function createStripeCheckoutSession(input: {
  organizationId: string;
  plan: string;
  priceId: string;
  customerEmail: string;
}) {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");

  if (!apiKey) {
    throw new Error("STRIPE_SECRET_KEY is required for billing checkout.");
  }

  const body = new URLSearchParams({
    mode: "subscription",
    success_url: `${appUrl}/settings?billing=success`,
    cancel_url: `${appUrl}/settings?billing=cancelled`,
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    customer_email: input.customerEmail,
    "metadata[organizationId]": input.organizationId,
    "metadata[plan]": input.plan,
    "subscription_data[metadata][organizationId]": input.organizationId,
    "subscription_data[metadata][plan]": input.plan,
  });

  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text().catch(() => "");
    throw new Error(`Stripe checkout failed with ${response.status}: ${error}`);
  }

  return (await response.json()) as { id: string; url?: string | null };
}

export function stripePriceIdForPlan(plan: string) {
  if (plan === "Starter") return process.env.STRIPE_PRICE_STARTER;
  if (plan === "Growth") return process.env.STRIPE_PRICE_GROWTH;
  if (plan === "Enterprise") return process.env.STRIPE_PRICE_ENTERPRISE;
  return null;
}
