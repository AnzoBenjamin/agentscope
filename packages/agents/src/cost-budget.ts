import { and, eq, gte, sql } from "@agentscope/db";
import {
  AgentCostBudget,
  AgentRun,
  UsageLedger,
} from "@agentscope/db/schema";
import type { Agent as AgentTable } from "@agentscope/db/schema";
import { costBudgetBlockedTotal } from "@agentscope/observability";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
  NodePgDatabase,
  NodePgTransaction,
} from "drizzle-orm/node-postgres";
import type * as schema from "@agentscope/db/schema";

/**
 * Accepts either the full pg database handle or a transaction handle so
 * callers can run budget checks inside an existing `db.transaction` block
 * (e.g. the run queue wraps the claim + cost check + enqueue atomically).
 */
type AgentScopeDb =
  | NodePgDatabase<typeof schema>
  | NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

export type CostBudgetPeriod = "Hourly" | "Daily" | "Weekly" | "Monthly";

export interface BudgetUsage {
  period: CostBudgetPeriod;
  usedCents: number;
  usedTokens: number;
  maxCostCents: number;
  maxTokens: number;
  enforceHardCap: boolean;
  remainingCents: number;
  remainingTokens: number;
}

export interface BudgetDecision {
  allowed: boolean;
  reason: string;
  usage: BudgetUsage[];
}

const periodWindows: Record<CostBudgetPeriod, () => Date> = {
  Hourly: () => new Date(Date.now() - 60 * 60 * 1000),
  Daily: () => new Date(Date.now() - 24 * 60 * 60 * 1000),
  Weekly: () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  Monthly: () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
};

export async function getAgentCostBudgets(
  db: AgentScopeDb,
  organizationId: string,
  agentId: string,
) {
  return db.query.AgentCostBudget.findMany({
    where: and(
      eq(AgentCostBudget.organizationId, organizationId),
      eq(AgentCostBudget.agentId, agentId),
      eq(AgentCostBudget.enabled, true),
    ),
  });
}

export async function evaluateAgentCostBudgets(
  db: AgentScopeDb,
  organizationId: string,
  agentId: string,
): Promise<BudgetDecision> {
  const budgets = await getAgentCostBudgets(db, organizationId, agentId);
  if (budgets.length === 0) {
    return { allowed: true, reason: "No cost budget configured.", usage: [] };
  }

  const usage: BudgetUsage[] = [];
  for (const budget of budgets) {
    const period = budget.period as CostBudgetPeriod;
    const since = periodWindows[period]();
    // `UsageLedger` stores cost and tokens as separate rows with different
    // `metric` values ("model_cost" carries cents in `costCents`, "tokens"
    // carries the natural unit in `quantity`). We aggregate both in a single
    // pass so a single budget window can enforce cost and token caps.
    const rows = await db
      .select({
        usedCents: sql<number>`coalesce(sum(case when ${UsageLedger.metric} = 'model_cost' then ${UsageLedger.costCents} else 0 end), 0)::int`,
        usedTokens: sql<number>`coalesce(sum(case when ${UsageLedger.metric} = 'tokens' then ${UsageLedger.quantity} else 0 end), 0)::int`,
      })
      .from(UsageLedger)
      .innerJoin(AgentRun, eq(UsageLedger.agentRunId, AgentRun.id))
      .where(
        and(
          eq(AgentRun.organizationId, organizationId),
          eq(AgentRun.agentId, agentId),
          gte(UsageLedger.createdAt, since),
        ),
      );

    const usedCents = Number(rows[0]?.usedCents ?? 0);
    const usedTokens = Number(rows[0]?.usedTokens ?? 0);
    usage.push({
      period,
      usedCents,
      usedTokens,
      maxCostCents: budget.maxCostCents,
      maxTokens: budget.maxTokens,
      enforceHardCap: budget.enforceHardCap,
      remainingCents: Math.max(0, budget.maxCostCents - usedCents),
      remainingTokens: Math.max(0, budget.maxTokens - usedTokens),
    });
  }

  const overBudget = usage.find(
    (u) =>
      (u.maxCostCents > 0 && u.usedCents >= u.maxCostCents) ||
      (u.maxTokens > 0 && u.usedTokens >= u.maxTokens),
  );

  if (overBudget) {
    // Count blocked runs only when hard-capping is enabled.
    if (overBudget.enforceHardCap) {
      costBudgetBlockedTotal.inc({ period: overBudget.period });
      return {
        allowed: false,
        reason: `Agent has exceeded its ${overBudget.period} cost budget (${overBudget.usedCents} of ${overBudget.maxCostCents} cents, ${overBudget.usedTokens} of ${overBudget.maxTokens} tokens).`,
        usage,
      };
    }
    return {
      allowed: true,
      reason: `Advisory: agent has exceeded its ${overBudget.period} cost budget; hard cap is not enabled.`,
      usage,
    };
  }

  return { allowed: true, reason: "Within budget.", usage };
}

/**
 * Record a successful run's cost/tokens to the usage ledger.
 * Called from the run queue after a run completes.
 */
export async function recordAgentRunCost(
  db: AgentScopeDb,
  run: typeof AgentRun.$inferSelect,
) {
  if (!run.sessionId) return;
  await db.insert(UsageLedger).values([
    {
      organizationId: run.organizationId,
      agentRunId: run.id,
      sessionId: run.sessionId,
      metric: "agent_run",
      quantity: 1,
      costCents: 0,
      metadata: { status: run.status, agentId: run.agentId },
    },
    {
      organizationId: run.organizationId,
      agentRunId: run.id,
      sessionId: run.sessionId,
      // `run.totalCost` is in dollars. `quantity` is the natural unit for the
      // `model_cost` metric, so we store cents (= dollars * 100). The monetary
      // value is also recorded in `costCents` for downstream aggregation.
      metric: "model_cost",
      quantity: Math.round(run.totalCost * 100),
      costCents: Math.round(run.totalCost * 100),
      metadata: { totalCost: run.totalCost, agentId: run.agentId },
    },
    {
      organizationId: run.organizationId,
      agentRunId: run.id,
      sessionId: run.sessionId,
      metric: "tokens",
      quantity: run.totalTokens,
      costCents: 0,
      metadata: { agentId: run.agentId },
    },
  ]);
}

export type AgentRecord = typeof AgentTable.$inferSelect;
