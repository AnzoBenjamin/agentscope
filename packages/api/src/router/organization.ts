import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { eq } from "@agentscope/db";
import { Organization } from "@agentscope/db/schema";

import { writeAuditLog } from "../audit";
import { orgProcedure, requireRole } from "../trpc";

export const organizationRouter = {
  current: orgProcedure.query(({ ctx }) => {
    return ctx.db.query.Organization.findFirst({
      where: eq(Organization.id, ctx.organizationId),
    });
  }),

  update: requireRole("Admin")
    .input(
      z.object({
        name: z.string().trim().min(2).max(256).optional(),
        slug: z
          .string()
          .trim()
          .min(2)
          .max(128)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.slug) {
        const existing = await ctx.db.query.Organization.findFirst({
          where: eq(Organization.slug, input.slug),
        });

        if (existing && existing.id !== ctx.organizationId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Organization slug is already in use.",
          });
        }
      }

      const [organization] = await ctx.db
        .update(Organization)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(Organization.id, ctx.organizationId))
        .returning();

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "organization.update",
        resourceType: "organization",
        resourceId: organization.id,
        payload: input,
      });

      return organization;
    }),
} satisfies TRPCRouterRecord;
