import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "@agentscope/db";
import {
  AGENT_COST_BUDGET_PERIODS,
  Agent as AgentTable,
  AgentCostBudget,
} from "@agentscope/db/schema";
import { z } from "zod/v4";

import { writeAuditLog } from "../audit";
import { requireRole } from "../trpc";
const createInput = z.object({
  agentId: z.string(),
  name: z.string().min(2).max(256),
  period: z.enum(AGENT_COST_BUDGET_PERIODS),
  maxCostCents: z.number().int().min(0).max(100_000_000),
  maxTokens: z.number().int().min(0).max(10_000_000_000),
  enforceHardCap: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

const updateInput = z.object({
  id: z.string(),
  name: z.string().min(2).max(256).optional(),
  maxCostCents: z.number().int().min(0).max(100_000_000).optional(),
  maxTokens: z.number().int().min(0).max(10_000_000_000).optional(),
  enforceHardCap: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const costBudgetRouter = {
  forAgent: requireRole("Viewer")
    .input(z.object({ agentId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.query.AgentCostBudget.findMany({
        where: and(
          eq(AgentCostBudget.organizationId, ctx.organizationId),
          eq(AgentCostBudget.agentId, input.agentId),
        ),
        orderBy: desc(AgentCostBudget.createdAt),
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
      const [budget] = await ctx.db
        .insert(AgentCostBudget)
        .values({
          organizationId: ctx.organizationId,
          agentId: input.agentId,
          name: input.name,
          period: input.period,
          maxCostCents: input.maxCostCents,
          maxTokens: input.maxTokens,
          enforceHardCap: input.enforceHardCap,
          enabled: input.enabled,
          createdByUserId: ctx.session.user.id,
        })
        .onConflictDoUpdate({
          target: [AgentCostBudget.agentId, AgentCostBudget.period],
          set: {
            name: input.name,
            maxCostCents: input.maxCostCents,
            maxTokens: input.maxTokens,
            enforceHardCap: input.enforceHardCap,
            enabled: input.enabled,
            updatedAt: new Date(),
          },
        })
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "cost_budget.upsert",
        resourceType: "agent_cost_budget",
        resourceId: budget?.id,
        payload: input,
      });

      return budget;
    }),

  update: requireRole("Manager")
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [updated] = await ctx.db
        .update(AgentCostBudget)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(
            eq(AgentCostBudget.id, id),
            eq(AgentCostBudget.organizationId, ctx.organizationId),
          ),
        )
        .returning();
      return updated;
    }),

  delete: requireRole("Manager")
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.db
        .delete(AgentCostBudget)
        .where(
          and(
            eq(AgentCostBudget.id, input.id),
            eq(AgentCostBudget.organizationId, ctx.organizationId),
          ),
        );
    }),
} satisfies TRPCRouterRecord;
