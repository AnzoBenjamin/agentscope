import type { db as defaultDb } from "@agentscope/db/client";
import { and, eq, gte } from "@agentscope/db";
import {
  Agent,
  AgentRun,
  OrganizationSubscription,
  UsageLedger,
} from "@agentscope/db/schema";
import { evaluateAgentCostBudgets } from "@agentscope/agents";

type AgentScopeDb = typeof defaultDb;

export interface PlanLimits {
  agents: number;
  runs: number;
  tokens: number;
  monthlyCostCents: number;
}

export const PLAN_LIMITS = {
  Free: { agents: 2, runs: 100, tokens: 100_000, monthlyCostCents: 0 },
  Starter: {
    agents: 5,
    runs: 1_000,
    tokens: 1_000_000,
    monthlyCostCents: 20_000,
  },
  Growth: {
    agents: 25,
    runs: 10_000,
    tokens: 10_000_000,
    monthlyCostCents: 200_000,
  },
  Enterprise: {
    agents: 999_999,
    runs: 999_999_999,
    tokens: 999_999_999_999,
    monthlyCostCents: 999_999_999,
  },
} satisfies Record<string, PlanLimits>;

export async function entitlementSummary(
  db: AgentScopeDb,
  organizationId: string,
) {
  const subscription = await db.query.OrganizationSubscription.findFirst({
    where: eq(OrganizationSubscription.organizationId, organizationId),
  });
  // `plan` is always one of the keys in `PLAN_LIMITS` (the `subscription.plan`
  // column is a varchar but the zod schema on the create/update subscription
  // router constrains it to the four known plans). The `in` operator narrows
  // `plan` to `keyof typeof PLAN_LIMITS` inside the true branch, so the index
  // access is total at the type level; the explicit `PlanLimits` annotation
  // forces TS to verify the ternary narrows correctly. If bad data somehow
  // slips past the zod schema, we fall back to the Starter limits rather
  // than letting the lookup return `undefined` and crashing downstream.
  const plan = subscription?.plan ?? "Starter";
  const periodStart =
    subscription?.currentPeriodStart ??
    new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const limits: PlanLimits =
    plan in PLAN_LIMITS
      ? PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]
      : PLAN_LIMITS.Starter;

  const [agents, runs, usage] = await Promise.all([
    db.query.Agent.findMany({
      where: eq(Agent.organizationId, organizationId),
    }),
    db.query.AgentRun.findMany({
      where: and(
        eq(AgentRun.organizationId, organizationId),
        gte(AgentRun.createdAt, periodStart),
      ),
    }),
    db.query.UsageLedger.findMany({
      where: and(
        eq(UsageLedger.organizationId, organizationId),
        gte(UsageLedger.createdAt, periodStart),
      ),
    }),
  ]);

  const activeAgents = agents.filter((agent) => agent.status !== "Archived");
  const tokenUsage = usage
    .filter((row) => row.metric === "tokens")
    .reduce((sum, row) => sum + row.quantity, 0);
  const costCents = usage.reduce((sum, row) => sum + row.costCents, 0);

  return {
    plan,
    limits,
    usage: {
      agents: activeAgents.length,
      runs: runs.length,
      tokens: tokenUsage,
      monthlyCostCents: costCents,
    },
  };
}

export async function canCreateAgent(db: AgentScopeDb, organizationId: string) {
  const summary = await entitlementSummary(db, organizationId);
  return {
    ...summary,
    allowed: summary.usage.agents < summary.limits.agents,
    reason: `Plan ${summary.plan} allows ${summary.limits.agents} active agents.`,
  };
}

export async function canEnqueueRun(db: AgentScopeDb, organizationId: string) {
  const summary = await entitlementSummary(db, organizationId);
  const runAllowed = summary.usage.runs < summary.limits.runs;
  const tokenAllowed = summary.usage.tokens < summary.limits.tokens;
  const costAllowed =
    summary.usage.monthlyCostCents < summary.limits.monthlyCostCents;

  return {
    ...summary,
    allowed: runAllowed && tokenAllowed && costAllowed,
    reason: runAllowed
      ? tokenAllowed
        ? costAllowed
          ? "Entitlements available."
          : `Plan ${summary.plan} monthly cost limit reached.`
        : `Plan ${summary.plan} token limit reached.`
      : `Plan ${summary.plan} run limit reached.`,
  };
}

export async function evaluateAgentBudget(
  db: AgentScopeDb,
  organizationId: string,
  agentId: string,
) {
  return evaluateAgentCostBudgets(db, organizationId, agentId);
}
