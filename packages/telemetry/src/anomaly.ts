/**
 * Splunk anomaly detection integration.
 *
 * Uses Splunk's REST API to run SPL commands with ML Toolkit algorithms
 * for detecting anomalies in AI agent behavior:
 * - Hallucination spikes (unusual ModelCompleted events without tool verification)
 * - Cost anomalies (sudden cost increases per agent/session)
 * - Failure rate anomalies (spikes in SessionFailed events)
 * - Token usage anomalies (unusual token consumption patterns)
 *
 * Configuration via environment variables:
 * - SPLUNK_ANOMALY_URL: Splunk search endpoint (default: https://localhost:8089/services/search/jobs)
 * - SPLUNK_ANOMALY_USER: Splunk username
 * - SPLUNK_ANOMALY_PASSWORD: Splunk password
 */

const ANOMALY_URL =
  process.env.SPLUNK_ANOMALY_URL ??
  "https://localhost:8089/services/search/jobs";
const ANOMALY_USER = process.env.SPLUNK_ANOMALY_USER ?? "admin";
const ANOMALY_PASSWORD = process.env.SPLUNK_ANOMALY_PASSWORD ?? "";

const anomalyEnabled = !!ANOMALY_PASSWORD;

export function isAnomalyEnabled(): boolean {
  return anomalyEnabled;
}

async function runSplunkSearch(spl: string): Promise<unknown> {
  if (!anomalyEnabled) return null;

  const auth = Buffer.from(`${ANOMALY_USER}:${ANOMALY_PASSWORD}`).toString(
    "base64",
  );

  try {
    // Submit search job
    const res = await fetch(`${ANOMALY_URL}?output_mode=json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        search: spl,
        exec_mode: "oneshot",
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export interface AnomalyResult {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  value: number;
  threshold: number;
  affectedAgent?: string;
  timestamp: string;
}

/**
 * Detect cost anomalies: flag agents whose cost per session
 * exceeds the historical average by 3 standard deviations.
 */
export async function detectCostAnomalies(): Promise<AnomalyResult[]> {
  // Two-step approach: first get per-agent cost stats, then get recent costs
  const statsResult = await runSplunkSearch(
    `search index=main sourcetype=agentscope:event eventType=CostRecorded
    | stats avg(cost) as avg_cost, stdev(cost) as stdev_cost by agentName
    | where isnotnull(stdev_cost)`,
  );

  if (!statsResult) return [];
  const stats =
    (statsResult as { results?: Record<string, string>[] }).results ?? [];

  // For each agent, get the latest session cost to compare against threshold
  const recentResult = await runSplunkSearch(
    `search index=main sourcetype=agentscope:event eventType=CostRecorded
    | dedup agentName sortby -_time
    | table agentName cost`,
  );

  const recentCosts = new Map<string, number>();
  if (recentResult) {
    const rows =
      (recentResult as { results?: Record<string, string>[] }).results ?? [];
    for (const row of rows) {
      recentCosts.set(row.agentName ?? "", parseFloat(row.cost ?? "0"));
    }
  }

  // Only return agents whose most recent cost exceeds avg + 3*stdev
  return stats
    .filter((row) => {
      const threshold =
        parseFloat(row.avg_cost ?? "0") + 3 * parseFloat(row.stdev_cost ?? "0");
      const recent = recentCosts.get(row.agentName ?? "");
      return recent !== undefined && recent > threshold;
    })
    .map((row) => {
      const threshold =
        parseFloat(row.avg_cost ?? "0") + 3 * parseFloat(row.stdev_cost ?? "0");
      return {
        type: "cost_anomaly" as const,
        severity: "high" as const,
        description: `Agent ${row.agentName}: recent cost ($${recentCosts.get(row.agentName ?? "")?.toFixed(4)}) exceeds threshold ($${threshold.toFixed(4)})`,
        value: recentCosts.get(row.agentName ?? "") ?? 0,
        threshold,
        affectedAgent: row.agentName ?? "unknown",
        timestamp: new Date().toISOString(),
      };
    });
}

/**
 * Detect failure rate anomalies: flag when failure rate exceeds
 * expected baseline using numerical outlier detection.
 */
export async function detectFailureAnomalies(): Promise<AnomalyResult[]> {
  const result = await runSplunkSearch(
    `search index=main sourcetype=agentscope:event (eventType=SessionCompleted OR eventType=SessionFailed)
    | timechart span=1h count(eval(eventType="SessionFailed")) as failures,
      count(eval(eventType="SessionCompleted")) as completions
    | eval failure_rate = failures / (failures + completions) * 100
    | fit DetectNumericalOutliers failure_rate`,
  );

  if (!result) return [];
  const rows = (result as { results?: Record<string, string>[] }).results ?? [];
  return rows
    .filter((r) => r.IsOutlier === "1")
    .map((row) => ({
      type: "failure_anomaly",
      severity: "critical",
      description: `Failure rate anomaly detected: ${row.failure_rate}%`,
      value: parseFloat(row.failure_rate ?? "0"),
      threshold: parseFloat(row.BoundaryRanges ?? "100"),
      timestamp: row._time ?? new Date().toISOString(),
    }));
}

/**
 * Detect hallucination indicators: unusual ratios of ModelCompleted
 * events without corresponding tool calls (potential hallucination signal).
 */
export async function detectHallucinationAnomalies(): Promise<AnomalyResult[]> {
  const result = await runSplunkSearch(
    `search index=main sourcetype=agentscope:event
    | stats count(eval(eventType="ToolCalled")) as tool_calls,
      count(eval(eventType="ModelCompleted")) as model_calls
      by sessionId
    | eval ratio = model_calls / (tool_calls + 1)
    | where ratio > 5`,
  );

  if (!result) return [];
  const rows = (result as { results?: Record<string, string>[] }).results ?? [];
  return rows.map((row) => ({
    type: "hallucination_risk",
    severity: "medium",
    description: `Session ${row.sessionId}: high model-to-tool ratio (${row.ratio}) - possible hallucination`,
    value: parseFloat(row.ratio ?? "0"),
    threshold: 5,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Run all anomaly detection checks and return combined results.
 */
export async function runAllAnomalyChecks(): Promise<AnomalyResult[]> {
  if (!anomalyEnabled) return [];

  const [costResults, failureResults, hallucinationResults] = await Promise.all(
    [
      detectCostAnomalies(),
      detectFailureAnomalies(),
      detectHallucinationAnomalies(),
    ],
  );

  return [...costResults, ...failureResults, ...hallucinationResults];
}
