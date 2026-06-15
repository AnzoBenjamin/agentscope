import type { TRPCRouterRecord } from "@trpc/server";

import { and, desc, eq, gte, sql } from "@agentscope/db";
import {
  Agent,
  AgentRun,
  AlertDelivery,
  AnalyticsSnapshot,
  ComplianceExport,
  Cost,
  OperationalInsight,
  Session,
  UsageLedger,
} from "@agentscope/db/schema";

import { orgProcedure } from "../trpc";

export const analyticsRouter = {
  /** Executive dashboard summary */
  dashboardSummary: orgProcedure.query(async ({ ctx }) => {
    const agents = await ctx.db.query.Agent.findMany({
      where: eq(Agent.organizationId, ctx.organizationId),
    });
    const sessions = await ctx.db.query.Session.findMany({
      where: eq(Session.organizationId, ctx.organizationId),
    });
    const costs = await ctx.db.query.Cost.findMany();
    const sessionIds = new Set(sessions.map((session) => session.id));
    const orgCosts = costs.filter((cost) => sessionIds.has(cost.sessionId));

    const activeAgents = agents.filter((a) => a.status === "Active").length;
    const completedTasks = sessions.filter(
      (s) => s.status === "Completed",
    ).length;
    const failedTasks = sessions.filter((s) => s.status === "Failed").length;
    const totalCost = orgCosts.reduce((sum, c) => sum + (c.cost ?? 0), 0);
    const totalTokens = sessions.reduce(
      (sum, s) => sum + (s.totalTokens ?? 0),
      0,
    );

    const reliability =
      sessions.length > 0
        ? Math.round(((completedTasks - failedTasks) / sessions.length) * 100)
        : 100;

    return {
      organizationId: ctx.organizationId,
      activeAgents,
      totalAgents: agents.length,
      completedTasks,
      failedTasks,
      totalSessions: sessions.length,
      totalCost: Math.round(totalCost * 100) / 100,
      totalTokens,
      reliabilityScore: Math.max(reliability, 0),
    };
  }),

  /** Per-agent stats */
  agentStats: orgProcedure.query(async ({ ctx }) => {
    const agents = await ctx.db.query.Agent.findMany({
      where: eq(Agent.organizationId, ctx.organizationId),
    });

    const stats = await Promise.all(
      agents.map(async (agent) => {
        const sessions = await ctx.db.query.Session.findMany({
          where: and(
            eq(Session.agentId, agent.id),
            eq(Session.organizationId, ctx.organizationId),
          ),
        });

        const completed = sessions.filter(
          (s) => s.status === "Completed",
        ).length;
        const failed = sessions.filter((s) => s.status === "Failed").length;
        const total = sessions.length;
        const totalTokens = sessions.reduce(
          (s, t) => s + (t.totalTokens ?? 0),
          0,
        );
        const totalCost = sessions.reduce((s, t) => s + (t.totalCost ?? 0), 0);

        return {
          agentId: agent.id,
          agentName: agent.name,
          modelProvider: agent.modelProvider,
          status: agent.status,
          totalSessions: total,
          completed,
          failed,
          reliability: total > 0 ? Math.round((completed / total) * 100) : 100,
          totalTokens,
          totalCost: Math.round(totalCost * 100) / 100,
          efficiency:
            total > 0 ? Math.round(((completed - failed) / total) * 100) : 100,
        };
      }),
    );

    return stats;
  }),

  /** Cost over time (last 30 days) */
  costHistory: orgProcedure.query(async ({ ctx }) => {
    const sessions = await ctx.db.query.Session.findMany({
      where: eq(Session.organizationId, ctx.organizationId),
    });
    const sessionIds = new Set(sessions.map((session) => session.id));
    const costs = await ctx.db.query.Cost.findMany({
      orderBy: desc(Cost.createdAt),
      limit: 100,
    });

    return costs
      .filter((c) => sessionIds.has(c.sessionId))
      .map((c) => ({
        date: c.createdAt.toISOString().split("T")[0],
        provider: c.provider,
        cost: c.cost ?? 0,
        tokensIn: c.tokensIn ?? 0,
        tokensOut: c.tokensOut ?? 0,
      }))
      .reverse();
  }),

  /** Worker queue and retry posture */
  queueHealth: orgProcedure.query(async ({ ctx }) => {
    const runs = await ctx.db.query.AgentRun.findMany({
      where: eq(AgentRun.organizationId, ctx.organizationId),
      orderBy: desc(AgentRun.createdAt),
      limit: 250,
    });

    const byStatus = runs.reduce<Record<string, number>>((acc, run) => {
      acc[run.status] = (acc[run.status] ?? 0) + 1;
      return acc;
    }, {});
    const oldestPending = runs
      .filter((run) => run.status === "Queued" || run.status === "Retrying")
      .at(-1);

    return {
      totalRuns: runs.length,
      queued: byStatus.Queued ?? 0,
      running: byStatus.Running ?? 0,
      retrying: byStatus.Retrying ?? 0,
      completed: byStatus.Completed ?? 0,
      failed: byStatus.Failed ?? 0,
      cancelled: byStatus.Cancelled ?? 0,
      oldestPendingAt: oldestPending?.createdAt ?? null,
      maxAttemptsObserved: Math.max(0, ...runs.map((run) => run.attempts)),
    };
  }),

  modelCostBreakdown: orgProcedure.query(async ({ ctx }) => {
    const sessions = await ctx.db.query.Session.findMany({
      where: eq(Session.organizationId, ctx.organizationId),
      columns: { id: true },
    });
    const sessionIds = new Set(sessions.map((session) => session.id));
    const costs = await ctx.db.query.Cost.findMany({
      orderBy: desc(Cost.createdAt),
      limit: 500,
    });

    return Object.values(
      costs
        .filter((cost) => sessionIds.has(cost.sessionId))
        .reduce<
          Record<
            string,
            {
              provider: string;
              modelName: string;
              totalCost: number;
              tokensIn: number;
              tokensOut: number;
              calls: number;
            }
          >
        >((acc, cost) => {
          const key = `${cost.provider}:${cost.modelName}`;
          acc[key] ??= {
            provider: cost.provider,
            modelName: cost.modelName,
            totalCost: 0,
            tokensIn: 0,
            tokensOut: 0,
            calls: 0,
          };
          acc[key].totalCost += cost.cost ?? 0;
          acc[key].tokensIn += cost.tokensIn ?? 0;
          acc[key].tokensOut += cost.tokensOut ?? 0;
          acc[key].calls += 1;
          return acc;
        }, {}),
    ).map((item) => ({
      ...item,
      totalCost: Math.round(item.totalCost * 10000) / 10000,
    }));
  }),

  reliabilityTrend: orgProcedure.query(async ({ ctx }) => {
    const sessions = await ctx.db.query.Session.findMany({
      where: eq(Session.organizationId, ctx.organizationId),
      orderBy: desc(Session.createdAt),
      limit: 500,
    });

    const byDate = sessions.reduce<
      Record<
        string,
        { date: string; completed: number; failed: number; total: number }
      >
    >((acc, session) => {
      const date = session.createdAt.toISOString().slice(0, 10);
      acc[date] ??= { date, completed: 0, failed: 0, total: 0 };
      acc[date].total += 1;
      if (session.status === "Completed") acc[date].completed += 1;
      if (session.status === "Failed") acc[date].failed += 1;
      return acc;
    }, {});

    return Object.values(byDate)
      .map((item) => ({
        ...item,
        reliability:
          item.total > 0
            ? Math.round((item.completed / item.total) * 100)
            : 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }),

  operationsSummary: orgProcedure.query(async ({ ctx }) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [usage, alerts, exports] = await Promise.all([
      ctx.db
        .select({
          metric: UsageLedger.metric,
          quantity: sql<number>`sum(${UsageLedger.quantity})::int`,
          costCents: sql<number>`sum(${UsageLedger.costCents})::int`,
        })
        .from(UsageLedger)
        .where(
          and(
            eq(UsageLedger.organizationId, ctx.organizationId),
            gte(UsageLedger.createdAt, since),
          ),
        )
        .groupBy(UsageLedger.metric),
      ctx.db.query.AlertDelivery.findMany({
        where: and(
          eq(AlertDelivery.organizationId, ctx.organizationId),
          gte(AlertDelivery.createdAt, since),
        ),
      }),
      ctx.db.query.ComplianceExport.findMany({
        where: and(
          eq(ComplianceExport.organizationId, ctx.organizationId),
          gte(ComplianceExport.createdAt, since),
        ),
      }),
    ]);

    return {
      usage,
      alertDeliveries24h: alerts.length,
      failedAlertDeliveries24h: alerts.filter(
        (alert) => alert.status === "Failed",
      ).length,
      complianceExports24h: exports.length,
    };
  }),

  snapshots: orgProcedure.query(({ ctx }) => {
    return ctx.db.query.AnalyticsSnapshot.findMany({
      where: eq(AnalyticsSnapshot.organizationId, ctx.organizationId),
      orderBy: desc(AnalyticsSnapshot.createdAt),
      limit: 30,
    });
  }),

  insights: orgProcedure.query(({ ctx }) => {
    return ctx.db.query.OperationalInsight.findMany({
      where: eq(OperationalInsight.organizationId, ctx.organizationId),
      orderBy: desc(OperationalInsight.createdAt),
      limit: 50,
    });
  }),

  generateOperationalInsights: orgProcedure.mutation(async ({ ctx }) => {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
    const [runs, usage, alerts] = await Promise.all([
      ctx.db.query.AgentRun.findMany({
        where: and(
          eq(AgentRun.organizationId, ctx.organizationId),
          gte(AgentRun.createdAt, windowStart),
        ),
      }),
      ctx.db.query.UsageLedger.findMany({
        where: and(
          eq(UsageLedger.organizationId, ctx.organizationId),
          gte(UsageLedger.createdAt, windowStart),
        ),
      }),
      ctx.db.query.AlertDelivery.findMany({
        where: and(
          eq(AlertDelivery.organizationId, ctx.organizationId),
          gte(AlertDelivery.createdAt, windowStart),
        ),
      }),
    ]);

    const deadLetters = runs.filter((run) => run.status === "DeadLettered");
    const retrying = runs.filter((run) => run.status === "Retrying");
    const totalCostCents = usage.reduce((sum, row) => sum + row.costCents, 0);
    const failedAlerts = alerts.filter((alert) => alert.status === "Failed");

    const [snapshot] = await ctx.db
      .insert(AnalyticsSnapshot)
      .values({
        organizationId: ctx.organizationId,
        snapshotType: "operations_24h",
        windowStart,
        windowEnd,
        metrics: {
          runs: runs.length,
          deadLetters: deadLetters.length,
          retrying: retrying.length,
          totalCostCents,
          failedAlerts: failedAlerts.length,
        },
      })
      .onConflictDoUpdate({
        target: [
          AnalyticsSnapshot.organizationId,
          AnalyticsSnapshot.snapshotType,
          AnalyticsSnapshot.windowStart,
          AnalyticsSnapshot.windowEnd,
        ],
        set: {
          metrics: {
            runs: runs.length,
            deadLetters: deadLetters.length,
            retrying: retrying.length,
            totalCostCents,
            failedAlerts: failedAlerts.length,
          },
        },
      })
      .returning();

    const insightValues = [
      deadLetters.length > 0
        ? {
            organizationId: ctx.organizationId,
            insightType: "dead_letters",
            severity: "critical",
            title: "Dead-lettered agent runs require review",
            description: `${deadLetters.length} agent runs exhausted retries in the last 24 hours.`,
            evidence: {
              runIds: deadLetters.map((run) => run.id),
            },
          }
        : null,
      retrying.length > 5
        ? {
            organizationId: ctx.organizationId,
            insightType: "retry_pressure",
            severity: "warning",
            title: "Retry pressure is elevated",
            description: `${retrying.length} agent runs are retrying in the last 24 hours.`,
            evidence: {
              runIds: retrying.map((run) => run.id),
            },
          }
        : null,
      failedAlerts.length > 0
        ? {
            organizationId: ctx.organizationId,
            insightType: "alert_delivery",
            severity: "warning",
            title: "Alert delivery failures detected",
            description: `${failedAlerts.length} alert deliveries failed in the last 24 hours.`,
            evidence: {
              alertDeliveryIds: failedAlerts.map((alert) => alert.id),
            },
          }
        : null,
    ].filter((item) => item !== null);

    const insights =
      insightValues.length === 0
        ? []
        : await ctx.db.insert(OperationalInsight).values(insightValues).returning();

    return {
      snapshot,
      insights,
    };
  }),
} satisfies TRPCRouterRecord;
