import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq } from "@agentscope/db";
import {
  ALERT_CHANNELS,
  ALERT_METRICS,
  AlertDelivery,
  AlertPolicy,
} from "@agentscope/db/schema";

import { writeAuditLog } from "../audit";
import { requireRole } from "../trpc";

const alertInput = z.object({
  name: z.string().trim().min(2).max(256),
  metric: z.enum(ALERT_METRICS),
  threshold: z.number(),
  comparison: z.enum(["gt", "gte", "lt", "lte"]).default("gte"),
  channel: z.enum(ALERT_CHANNELS),
  target: z.string().trim().min(3),
  enabled: z.boolean().default(true),
});

export const alertsRouter = {
  policies: requireRole("Viewer").query(({ ctx }) => {
    return ctx.db.query.AlertPolicy.findMany({
      where: eq(AlertPolicy.organizationId, ctx.organizationId),
      orderBy: desc(AlertPolicy.createdAt),
    });
  }),

  deliveries: requireRole("Viewer")
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return ctx.db.query.AlertDelivery.findMany({
        where: eq(AlertDelivery.organizationId, ctx.organizationId),
        orderBy: desc(AlertDelivery.createdAt),
        limit: input?.limit ?? 50,
      });
    }),

  createPolicy: requireRole("Admin")
    .input(alertInput)
    .mutation(async ({ ctx, input }) => {
      const [policy] = await ctx.db
        .insert(AlertPolicy)
        .values({
          organizationId: ctx.organizationId,
          ...input,
        })
        .returning();

      if (!policy) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create alert policy.",
        });
      }

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "alert_policy.create",
        resourceType: "alert_policy",
        resourceId: policy.id,
        payload: input,
      });

      return policy;
    }),

  updatePolicy: requireRole("Admin")
    .input(
      alertInput.partial().extend({
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [policy] = await ctx.db
        .update(AlertPolicy)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(AlertPolicy.id, id),
            eq(AlertPolicy.organizationId, ctx.organizationId),
          ),
        )
        .returning();

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert policy not found.",
        });
      }

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "alert_policy.update",
        resourceType: "alert_policy",
        resourceId: policy.id,
        payload: data,
      });

      return policy;
    }),

  deletePolicy: requireRole("Admin")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [policy] = await ctx.db
        .delete(AlertPolicy)
        .where(
          and(
            eq(AlertPolicy.id, input.id),
            eq(AlertPolicy.organizationId, ctx.organizationId),
          ),
        )
        .returning();

      if (policy) {
        await writeAuditLog({
          db: ctx.db,
          organizationId: ctx.organizationId,
          actorUserId: ctx.session.user.id,
          action: "alert_policy.delete",
          resourceType: "alert_policy",
          resourceId: policy.id,
          payload: {
            name: policy.name,
            metric: policy.metric,
          },
        });
      }

      return policy;
    }),
} satisfies TRPCRouterRecord;
