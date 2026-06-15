import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, gte, sql } from "@agentscope/db";
import {
  BILLING_PLANS,
  BillingInvoice,
  Organization,
  OrganizationSubscription,
  UsageLedger,
} from "@agentscope/db/schema";

import { writeAuditLog } from "../audit";
import {
  createStripeCheckoutSession,
  isStripeConfigured,
  stripePriceIdForPlan,
} from "../billing/stripe";
import { entitlementSummary } from "../entitlements";
import { requireRole } from "../trpc";

export const billingRouter = {
  summary: requireRole("Viewer").query(async ({ ctx }) => {
    const subscription = await ctx.db.query.OrganizationSubscription.findFirst({
      where: eq(OrganizationSubscription.organizationId, ctx.organizationId),
    });
    const invoices = await ctx.db.query.BillingInvoice.findMany({
      where: eq(BillingInvoice.organizationId, ctx.organizationId),
      orderBy: desc(BillingInvoice.createdAt),
      limit: 10,
    });
    const periodStart =
      subscription?.currentPeriodStart ??
      new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const usage = await ctx.db
      .select({
        metric: UsageLedger.metric,
        quantity: sql<number>`sum(${UsageLedger.quantity})::int`,
        costCents: sql<number>`sum(${UsageLedger.costCents})::int`,
      })
      .from(UsageLedger)
      .where(
        and(
          eq(UsageLedger.organizationId, ctx.organizationId),
          gte(UsageLedger.createdAt, periodStart),
        ),
      )
      .groupBy(UsageLedger.metric);

    const plan = subscription?.plan ?? "Starter";
    const entitlements = await entitlementSummary(ctx.db, ctx.organizationId);

    return {
      stripeConfigured: isStripeConfigured(),
      subscription,
      plan,
      limits: entitlements.limits,
      entitlementUsage: entitlements.usage,
      usage,
      invoices,
    };
  }),

  createCheckoutSession: requireRole("Admin")
    .input(z.object({ plan: z.enum(BILLING_PLANS) }))
    .mutation(async ({ ctx, input }) => {
      if (input.plan === "Free") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Free plan does not require checkout.",
        });
      }

      const priceId = stripePriceIdForPlan(input.plan);
      if (!priceId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Missing Stripe price env for ${input.plan}.`,
        });
      }

      const organization = await ctx.db.query.Organization.findFirst({
        where: eq(Organization.id, ctx.organizationId),
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      try {
        const session = await createStripeCheckoutSession({
          organizationId: ctx.organizationId,
          plan: input.plan,
          priceId,
          customerEmail: ctx.session.user.email,
        });

        await writeAuditLog({
          db: ctx.db,
          organizationId: ctx.organizationId,
          actorUserId: ctx.session.user.id,
          action: "billing.checkout_create",
          resourceType: "organization_subscription",
          resourceId: organization.id,
          payload: {
            plan: input.plan,
            stripeSessionId: session.id,
          },
        });

        return session;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create Stripe checkout session.",
          cause: error,
        });
      }
    }),
} satisfies TRPCRouterRecord;
