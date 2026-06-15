import type { db as defaultDb } from "@agentscope/db/client";
import type { ALERT_METRICS } from "@agentscope/db/schema";
import { and, desc, eq, gte, inArray, sql } from "@agentscope/db";
import { AgentRun, AlertDelivery, AlertPolicy } from "@agentscope/db/schema";
import { createLogger } from "@agentscope/observability";
import { checkSplunkHecHealth, emitStreamEvent } from "@agentscope/telemetry";

const logger = createLogger("agents.alerts");

type AgentScopeDb = typeof defaultDb;
type AgentRunRecord = typeof AgentRun.$inferSelect;
type AlertPolicyRecord = typeof AlertPolicy.$inferSelect;
type AlertMetric = (typeof ALERT_METRICS)[number];

const defaultCooldownMs = Number(
  process.env.AGENTSCOPE_ALERT_COOLDOWN_MS ?? 15 * 60 * 1000,
);

export async function evaluateRunAlerts(db: AgentScopeDb, run: AgentRunRecord) {
  const policies = await db.query.AlertPolicy.findMany({
    where: and(
      eq(AlertPolicy.organizationId, run.organizationId),
      eq(AlertPolicy.enabled, true),
    ),
  });

  for (const policy of policies) {
    const value = metricValue(policy.metric, run);
    if (
      value === null ||
      !matches(policy.comparison, value, policy.threshold)
    ) {
      continue;
    }

    await deliverAlert(db, policy, {
      metric: policy.metric as AlertMetric,
      value,
      message: `${policy.name}: ${policy.metric} value ${value} matched ${policy.comparison} ${policy.threshold} for run ${run.id}.`,
      payload: {
        runId: run.id,
        status: run.status,
      },
    });
  }
}

export async function evaluateOperationalAlerts(db: AgentScopeDb) {
  const policies = await db.query.AlertPolicy.findMany({
    where: and(
      inArray(AlertPolicy.metric, ["QueueBacklog", "SplunkNotReady"]),
      eq(AlertPolicy.enabled, true),
    ),
  });

  if (policies.length === 0) return;

  const backlogByOrg = await queueBacklogByOrganization(db);
  let splunkReadyValue: number | null = null;
  let splunkHealth: Awaited<ReturnType<typeof checkSplunkHecHealth>> | null =
    null;

  for (const policy of policies) {
    let value: number | null = null;
    let payload: Record<string, unknown> = {};

    if (policy.metric === "QueueBacklog") {
      value = backlogByOrg.get(policy.organizationId) ?? 0;
      payload = {
        queuedRuns: value,
      };
    }

    if (policy.metric === "SplunkNotReady") {
      if (splunkReadyValue === null) {
        splunkHealth = await checkSplunkHecHealth();
        splunkReadyValue = splunkHealth.ok ? 0 : 1;
      }

      value = splunkReadyValue;
      payload = {
        configured: splunkHealth?.configured ?? false,
        ok: splunkHealth?.ok ?? false,
        status: splunkHealth?.status,
        url: splunkHealth?.url,
        error: splunkHealth?.error,
      };
    }

    if (
      value === null ||
      !matches(policy.comparison, value, policy.threshold)
    ) {
      continue;
    }

    if (await hasRecentDelivery(db, policy.id)) {
      continue;
    }

    await deliverAlert(db, policy, {
      metric: policy.metric as AlertMetric,
      value,
      message: `${policy.name}: ${policy.metric} value ${value} matched ${policy.comparison} ${policy.threshold}.`,
      payload,
    });
  }
}

function metricValue(metric: string, run: AgentRunRecord) {
  if (metric === "RunFailed") {
    return run.status === "Failed" || run.status === "DeadLettered" ? 1 : 0;
  }
  if (metric === "CostExceeded") return run.totalCost;
  return null;
}

function matches(comparison: string, value: number, threshold: number) {
  if (comparison === "gt") return value > threshold;
  if (comparison === "gte") return value >= threshold;
  if (comparison === "lt") return value < threshold;
  if (comparison === "lte") return value <= threshold;
  return value >= threshold;
}

async function deliverAlert(
  db: AgentScopeDb,
  policy: AlertPolicyRecord,
  alert: {
    metric: AlertMetric;
    value: number;
    message: string;
    payload: Record<string, unknown>;
  },
) {
  const payload = {
    policyId: policy.id,
    metric: alert.metric,
    value: alert.value,
    threshold: policy.threshold,
    ...alert.payload,
  };

  try {
    if (policy.channel === "Webhook") {
      await sendWebhook(policy.target, payload);
    } else {
      await sendEmail(policy.target, alert.message);
    }

    await db.insert(AlertDelivery).values({
      organizationId: policy.organizationId,
      alertPolicyId: policy.id,
      status: "Delivered",
      message: alert.message,
      payload,
      deliveredAt: new Date(),
    });

    await emitStreamEvent({
      organizationId: policy.organizationId,
      eventType: "alert.delivered",
      resourceType: "alert_policy",
      resourceId: policy.id,
      payload: { metric: alert.metric, value: alert.value },
    });
  } catch (error) {
    await db.insert(AlertDelivery).values({
      organizationId: policy.organizationId,
      alertPolicyId: policy.id,
      status: "Failed",
      message:
        error instanceof Error
          ? `${alert.message} Delivery failed: ${error.message}`
          : `${alert.message} Delivery failed.`,
      payload,
    });
  }
}

async function queueBacklogByOrganization(db: AgentScopeDb) {
  const rows = await db
    .select({
      organizationId: AgentRun.organizationId,
      count: sql<number>`count(*)::int`,
    })
    .from(AgentRun)
    .where(inArray(AgentRun.status, ["Queued", "Retrying"]))
    .groupBy(AgentRun.organizationId);

  return new Map<string, number>(
    rows.map((row: { organizationId: string; count: number }) => [
      row.organizationId,
      typeof row.count === "number" ? row.count : Number(row.count),
    ]),
  );
}

async function hasRecentDelivery(db: AgentScopeDb, alertPolicyId: string) {
  const recent = await db.query.AlertDelivery.findFirst({
    where: and(
      eq(AlertDelivery.alertPolicyId, alertPolicyId),
      gte(
        AlertDelivery.createdAt,
        new Date(Date.now() - Math.max(defaultCooldownMs, 0)),
      ),
    ),
    orderBy: desc(AlertDelivery.createdAt),
  });

  return !!recent;
}

async function sendWebhook(target: string, payload: Record<string, unknown>) {
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    logger.warn(
      { target, status: response.status },
      "alert webhook returned non-2xx",
    );
    throw new Error(`Webhook returned ${response.status}`);
  }
}


async function sendEmail(target: string, message: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and RESEND_FROM are required for alerts.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: target,
      subject: "AgentScope alert",
      text: message,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    logger.warn(
      { target, status: response.status },
      "alert email send returned non-2xx",
    );
    throw new Error(`Resend returned ${response.status}`);
  }
}
