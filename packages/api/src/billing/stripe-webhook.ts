import { createHmac, timingSafeEqual } from "node:crypto";

import { eq } from "@agentscope/db";
import { db } from "@agentscope/db/client";
import {
  BillingInvoice,
  Organization,
  OrganizationSubscription,
  ProcessedWebhookEvent,
} from "@agentscope/db/schema";

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

const WEBHOOK_SOURCE = "stripe";
/**
 * Maximum clock skew we will accept between the timestamp Stripe signs
 * and the time we receive the event. Stripe's official SDK defaults to
 * 300s; we keep that ceiling. Without it, a captured-and-replayed
 * signature from months ago would still verify.
 */
const STRIPE_TIMESTAMP_TOLERANCE_SECONDS = 300;

export async function handleStripeWebhook(input: {
  payload: string;
  signature: string | null;
}) {
  const event = verifyStripeEvent(input.payload, input.signature);

  // Idempotency / replay protection. Stripe retries any non-2xx and
  // will deliver the same `event.id` more than once for at-least-once
  // semantics. We record every successfully-processed event id; a
  // duplicate insert fails the unique index, and we treat that as
  // "already handled" and return the event to the caller so Stripe
  // stops retrying.
  try {
    await db.insert(ProcessedWebhookEvent).values({
      source: WEBHOOK_SOURCE,
      eventId: event.id,
      eventType: event.type,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ...event, duplicate: true };
    }
    throw error;
  }

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object);
  }

  if (event.type === "customer.subscription.updated") {
    await handleSubscriptionUpdated(event.data.object);
  }

  if (event.type === "customer.subscription.deleted") {
    await handleSubscriptionUpdated(event.data.object, "Cancelled");
  }

  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.finalized"
  ) {
    await handleInvoice(event.data.object);
  }

  return event;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  // node-postgres surfaces unique-index hits as SQLSTATE 23505. Drizzle
  // forwards the raw `pg` error on the `cause` field; check both.
  const code = (error as { code?: string }).code;
  if (code === "23505") return true;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as { code?: string }).code;
    if (causeCode === "23505") return true;
  }
  return false;
}

function verifyStripeEvent(payload: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is required.");
  }

  const timestamp = signature
    ?.split(",")
    .find((part) => part.startsWith("t="))
    ?.slice(2);
  const expected = signature
    ?.split(",")
    .find((part) => part.startsWith("v1="))
    ?.slice(3);

  if (!timestamp || !expected) {
    throw new Error("Invalid Stripe signature header.");
  }

  const timestampNumber = Number(timestamp);
  if (
    !Number.isFinite(timestampNumber) ||
    Math.abs(Date.now() / 1000 - timestampNumber) >
      STRIPE_TIMESTAMP_TOLERANCE_SECONDS
  ) {
    throw new Error("Stripe signature timestamp is out of tolerance.");
  }

  const signedPayload = `${timestamp}.${payload}`;
  const digest = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  const digestBuffer = Buffer.from(digest);
  const expectedBuffer = Buffer.from(expected);

  if (
    digestBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(digestBuffer, expectedBuffer)
  ) {
    throw new Error("Stripe signature verification failed.");
  }

  return JSON.parse(payload) as StripeEvent;
}

async function handleCheckoutCompleted(object: Record<string, unknown>) {
  const organizationId = metadataValue(object, "organizationId");
  if (!organizationId) return;

  await db
    .insert(OrganizationSubscription)
    .values({
      organizationId,
      plan: metadataValue(object, "plan") ?? "Starter",
      status: "Active",
      stripeCustomerId: stringValue(object.customer),
      stripeSubscriptionId: stringValue(object.subscription),
      currentPeriodStart: new Date(),
    })
    .onConflictDoUpdate({
      target: OrganizationSubscription.organizationId,
      set: {
        plan: metadataValue(object, "plan") ?? "Starter",
        status: "Active",
        stripeCustomerId: stringValue(object.customer),
        stripeSubscriptionId: stringValue(object.subscription),
        updatedAt: new Date(),
      },
    });

  await db
    .update(Organization)
    .set({
      plan: metadataValue(object, "plan") ?? "Starter",
      updatedAt: new Date(),
    })
    .where(eq(Organization.id, organizationId));
}

async function handleSubscriptionUpdated(
  object: Record<string, unknown>,
  forcedStatus?: string,
) {
  const organizationId = metadataValue(object, "organizationId");
  if (!organizationId) return;

  await db
    .insert(OrganizationSubscription)
    .values({
      organizationId,
      plan: metadataValue(object, "plan") ?? "Starter",
      status: forcedStatus ?? stripeStatus(stringValue(object.status)),
      stripeCustomerId: stringValue(object.customer),
      stripeSubscriptionId: stringValue(object.id),
      currentPeriodStart: dateFromUnix(object.current_period_start),
      currentPeriodEnd: dateFromUnix(object.current_period_end),
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
    })
    .onConflictDoUpdate({
      target: OrganizationSubscription.organizationId,
      set: {
        plan: metadataValue(object, "plan") ?? "Starter",
        status: forcedStatus ?? stripeStatus(stringValue(object.status)),
        stripeCustomerId: stringValue(object.customer),
        stripeSubscriptionId: stringValue(object.subscription),
        currentPeriodStart: dateFromUnix(object.current_period_start),
        currentPeriodEnd: dateFromUnix(object.current_period_end),
        cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
        updatedAt: new Date(),
      },
    });
}

async function handleInvoice(object: Record<string, unknown>) {
  const organizationId =
    metadataValue(object, "organizationId") ??
    (await organizationIdByCustomer(stringValue(object.customer)));

  if (!organizationId) return;

  const invoice = {
    organizationId,
    stripeInvoiceId: stringValue(object.id),
    number: stringValue(object.number),
    status: stripeInvoiceStatus(stringValue(object.status)),
    currency: stringValue(object.currency) ?? "usd",
    subtotalCents: numberValue(object.subtotal),
    taxCents: numberValue(object.tax),
    totalCents: numberValue(object.total),
    hostedInvoiceUrl: stringValue(object.hosted_invoice_url),
    periodStart: dateFromUnix(object.period_start),
    periodEnd: dateFromUnix(object.period_end),
    dueAt: dateFromUnix(object.due_date),
    paidAt: dateFromUnix(object.status_transitions, "paid_at"),
  };

  await db.insert(BillingInvoice).values(invoice).onConflictDoUpdate({
    target: BillingInvoice.stripeInvoiceId,
    set: invoice,
  });
}

async function organizationIdByCustomer(customerId: string | null) {
  if (!customerId) return null;

  const subscription = await db.query.OrganizationSubscription.findFirst({
    where: eq(OrganizationSubscription.stripeCustomerId, customerId),
  });

  return subscription?.organizationId ?? null;
}

function metadataValue(object: Record<string, unknown>, key: string) {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function dateFromUnix(value: unknown, nestedKey?: string) {
  const raw =
    nestedKey && value && typeof value === "object"
      ? (value as Record<string, unknown>)[nestedKey]
      : value;

  return typeof raw === "number" ? new Date(raw * 1000) : null;
}

function stripeStatus(status: string | null) {
  if (status === "active") return "Active";
  if (status === "past_due") return "PastDue";
  if (status === "canceled") return "Cancelled";
  if (status === "incomplete") return "Incomplete";
  return "Trialing";
}

function stripeInvoiceStatus(status: string | null) {
  if (status === "open") return "Open";
  if (status === "paid") return "Paid";
  if (status === "void") return "Void";
  if (status === "uncollectible") return "Uncollectible";
  return "Draft";
}
