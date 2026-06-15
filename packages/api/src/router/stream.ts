import type { TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, gte } from "@agentscope/db";
import { StreamEvent } from "@agentscope/db/schema";
import { getRecentStreamEvents } from "@agentscope/telemetry";
import { z } from "zod/v4";

import { requireRole } from "../trpc";

const recentInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  sinceMs: z.number().int().min(0).max(86_400_000).default(0),
  resourceType: z.string().max(64).optional(),
  resourceId: z.string().max(128).optional(),
});

export const streamRouter = {
  recent: requireRole("Viewer")
    .input(recentInput.optional())
    .query(({ ctx, input }) =>
      getRecentStreamEvents(ctx.organizationId, {
        db: ctx.db,
        limit: input?.limit ?? 50,
        sinceMs: input?.sinceMs,
        resourceType: input?.resourceType,
        resourceId: input?.resourceId,
      }),
    ),

  since: requireRole("Viewer")
    .input(z.object({ sinceMs: z.number().int().min(0).max(86_400_000) }))
    .query(({ ctx, input }) => {
      const since = new Date(Date.now() - input.sinceMs);
      return ctx.db.query.StreamEvent.findMany({
        where: and(
          eq(StreamEvent.organizationId, ctx.organizationId),
          gte(StreamEvent.createdAt, since),
        ),
        orderBy: desc(StreamEvent.createdAt),
        limit: 200,
      });
    }),
} satisfies TRPCRouterRecord;
