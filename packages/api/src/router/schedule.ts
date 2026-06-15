import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "@agentscope/db";
import {
  AGENT_SCHEDULE_FREQUENCIES,
  Agent as AgentTable,
  AgentSchedule,
  AgentScheduleRun,
} from "@agentscope/db/schema";
import { z } from "zod/v4";

import { writeAuditLog } from "../audit";
import { requireRole } from "../trpc";

const createInput = z.object({
  agentId: z.string(),
  name: z.string().min(2).max(256),
  frequency: z.enum(AGENT_SCHEDULE_FREQUENCIES),
  cronExpression: z.string().max(128).optional(),
  inputPrompt: z.string().min(1).max(4096),
  enabled: z.boolean().default(true),
});

const updateInput = z.object({
  id: z.string(),
  name: z.string().min(2).max(256).optional(),
  frequency: z.enum(AGENT_SCHEDULE_FREQUENCIES).optional(),
  cronExpression: z.string().max(128).optional(),
  inputPrompt: z.string().min(1).max(4096).optional(),
  enabled: z.boolean().optional(),
});

export const scheduleRouter = {
  all: requireRole("Viewer")
    .input(z.object({ agentId: z.string().optional() }).optional())
    .query(({ ctx, input }) => {
      const filters = [eq(AgentSchedule.organizationId, ctx.organizationId)];
      if (input?.agentId) {
        filters.push(eq(AgentSchedule.agentId, input.agentId));
      }
      return ctx.db.query.AgentSchedule.findMany({
        where: and(...filters),
        orderBy: desc(AgentSchedule.createdAt),
      });
    }),

  byId: requireRole("Viewer")
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.query.AgentSchedule.findFirst({
        where: and(
          eq(AgentSchedule.id, input.id),
          eq(AgentSchedule.organizationId, ctx.organizationId),
        ),
      });
    }),

  history: requireRole("Viewer")
    .input(z.object({ scheduleId: z.string(), limit: z.number().int().min(1).max(100).default(25) }))
    .query(({ ctx, input }) => {
      return ctx.db.query.AgentScheduleRun.findMany({
        where: and(
          eq(AgentScheduleRun.scheduleId, input.scheduleId),
          eq(AgentScheduleRun.organizationId, ctx.organizationId),
        ),
        orderBy: desc(AgentScheduleRun.triggeredAt),
        limit: input.limit,
      });
    }),

  create: requireRole("Manager")
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.db.query.Agent.findFirst({
        where: and(
          eq(AgentTable.id, input.agentId),
          eq(AgentTable.organizationId, ctx.organizationId),
        ),
      });
      if (!agent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found." });
      }
      const [schedule] = await ctx.db
        .insert(AgentSchedule)
        .values({
          organizationId: ctx.organizationId,
          agentId: input.agentId,
          name: input.name,
          frequency: input.frequency,
          cronExpression: input.cronExpression ?? null,
          inputPrompt: input.inputPrompt,
          enabled: input.enabled,
          nextRunAt: defaultNextRunAt(input.frequency),
          createdByUserId: ctx.session.user.id,
        })
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "schedule.create",
        resourceType: "agent_schedule",
        resourceId: schedule?.id,
        payload: input,
      });

      return schedule;
    }),

  update: requireRole("Manager")
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [updated] = await ctx.db
        .update(AgentSchedule)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(
            eq(AgentSchedule.id, id),
            eq(AgentSchedule.organizationId, ctx.organizationId),
          ),
        )
        .returning();
      return updated;
    }),

  delete: requireRole("Manager")
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.db
        .delete(AgentSchedule)
        .where(
          and(
            eq(AgentSchedule.id, input.id),
            eq(AgentSchedule.organizationId, ctx.organizationId),
          ),
        );
    }),

  /**
   * Most recent run per schedule, used to badge the schedule list with
   * the last-known status. We fetch all runs ordered by `triggeredAt`
   * desc and de-dup in memory — fine for typical org sizes, and avoids
   * a window function that's awkward to express in drizzle.
   */
  latestRuns: requireRole("Viewer").query(async ({ ctx }) => {
    const runs = await ctx.db.query.AgentScheduleRun.findMany({
      where: eq(AgentScheduleRun.organizationId, ctx.organizationId),
      orderBy: desc(AgentScheduleRun.triggeredAt),
    });
    const seen = new Set<string>();
    const latest: typeof runs = [];
    for (const run of runs) {
      if (seen.has(run.scheduleId)) continue;
      seen.add(run.scheduleId);
      latest.push(run);
    }
    return latest;
  }),
} satisfies TRPCRouterRecord;

function defaultNextRunAt(frequency: typeof AGENT_SCHEDULE_FREQUENCIES[number]) {
  const now = Date.now();
  const offset =
    frequency === "Hourly"
      ? 60 * 60 * 1000
      : frequency === "Daily"
        ? 24 * 60 * 60 * 1000
        : frequency === "Weekly"
          ? 7 * 24 * 60 * 60 * 1000
          : frequency === "Monthly"
            ? 30 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000; // Once and Cron default to daily
  return new Date(now + offset);
}
