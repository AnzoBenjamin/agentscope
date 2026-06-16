import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Single shared metrics registry. Use `getMetrics()` to get the singleton,
 * or `serializeMetrics()` to render Prometheus text-format output.
 */
let registry: Registry | null = null;
let initialized = false;

function ensureRegistry(): Registry {
  if (registry) return registry;

  registry = new Registry();
  registry.setDefaultLabels({
    service: process.env.AGENTSCOPE_SERVICE_NAME ?? "agentscope",
  });
  return registry;
}

/**
 * Initialize default Node.js process metrics. Idempotent.
 * Call once at process startup (worker, Next.js server, etc).
 */
export function initMetrics(): void {
  if (initialized) return;
  initialized = true;
  collectDefaultMetrics({ register: ensureRegistry() });
}

export function getMetrics(): Registry {
  initMetrics();
  return ensureRegistry();
}

export function resetMetrics(): void {
  registry = null;
  initialized = false;
}

export async function serializeMetrics(): Promise<string> {
  return getMetrics().metrics();
}

// --- AgentScope domain metrics -----------------------------------------

// IMPORTANT: metric label values are bounded to avoid Prometheus cardinality
// explosion. We deliberately do NOT include organization_id, agent_id,
// schedule_id, etc. as labels — those would create one time series per
// tenant and OOM the scraper in a multi-tenant deployment. Per-tenant
// breakdowns should be derived from logs or an external rollup.
export const agentRunsTotal = new Counter({
  name: "agent_runs_total",
  help: "Total number of agent runs processed, by status",
  labelNames: ["status"] as const,
  registers: [],
});

export const agentRunDurationSeconds = new Histogram({
  name: "agent_run_duration_seconds",
  help: "Agent run wall-clock duration in seconds",
  labelNames: ["status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [],
});

export const outboxEventsPending = new Gauge({
  name: "outbox_events_pending",
  help: "Current number of pending telemetry outbox events",
  registers: [],
});

export const outboxEventsDeliveredTotal = new Counter({
  name: "outbox_events_delivered_total",
  help: "Telemetry outbox events delivered, by destination",
  labelNames: ["destination", "status"] as const,
  registers: [],
});

export const splunkHecSendDurationSeconds = new Histogram({
  name: "splunk_hec_send_duration_seconds",
  help: "Splunk HEC send duration in seconds",
  labelNames: ["status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [],
});

export const splunkMcpSearchDurationSeconds = new Histogram({
  name: "splunk_mcp_search_duration_seconds",
  help: "Splunk MCP search duration in seconds (attempts is 1 on first try, 2+ when the indexer-delay retry path fired)",
  labelNames: ["status", "attempts"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15],
  registers: [],
});

export const rateLimitRejectionsTotal = new Counter({
  name: "rate_limit_rejections_total",
  help: "Rate limit rejections, by route",
  labelNames: ["route"] as const,
  registers: [],
});

export const trpcRequestDurationSeconds = new Histogram({
  name: "tRPC_request_duration_seconds",
  help: "tRPC request duration in seconds, by path and outcome",
  labelNames: ["path", "ok"] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [],
});

export const scheduledRunTriggersTotal = new Counter({
  name: "scheduled_run_triggers_total",
  help: "Scheduled agent runs triggered, by frequency",
  labelNames: ["frequency"] as const,
  registers: [],
});

export const costBudgetBlockedTotal = new Counter({
  name: "cost_budget_blocked_total",
  help: "Agent runs blocked by cost budget, by period",
  labelNames: ["period"] as const,
  registers: [],
});

export const sseConnections = new Gauge({
  name: "sse_connections",
  help: "Current number of active SSE event-stream connections",
  registers: [],
});

// --- Production-readiness protections (added with the hardening commit) ---

/**
 * Increments every time the Splunk MCP watchdog kills a hung child
 * process (no JSON-RPC response for `McpClient.KILL_IDLE_MS`). A
 * non-zero rate is a strong signal that the Splunk indexer is
 * unreachable or that the MCP server itself is wedged.
 */
export const mcpWatchdogKillsTotal = new Counter({
  name: "mcp_watchdog_kills_total",
  help: "Splunk MCP child processes killed by the idle watchdog",
  registers: [],
});

/**
 * Increments every time the MCP client successfully reconnects after
 * a prior failure. Pair with `mcp_init_failures_total` to derive
 * availability.
 */
export const mcpReconnectsTotal = new Counter({
  name: "mcp_reconnects_total",
  help: "Splunk MCP client reconnects after a prior failure",
  registers: [],
});

/**
 * Increments every time `initSplunkMcp` fails to reach a healthy
 * state (spawn ENOENT, `initialize` error, `tools/list` error).
 * Includes re-spawn attempts suppressed by the backoff window
 * (status: `suppressed`) so SREs can see the full picture in metrics
 * without tailing logs.
 */
export const mcpInitFailuresTotal = new Counter({
  name: "mcp_init_failures_total",
  help: "Splunk MCP init attempts that failed, by status",
  labelNames: ["status"] as const,
  registers: [],
});

/**
 * Counts every Stripe webhook event the API receives, by terminal
 * outcome. Useful for spotting a replay storm (`status="dedup"`) or a
 * bad signing secret (`status="invalid"`).
 *
 *   accepted - first time we saw this event id; business logic ran
 *   dedup    - event id was already in processed_webhook_event
 *   invalid - signature verification failed (bad sig, no header)
 *   expired  - signature timestamp outside STRIPE_TIMESTAMP_TOLERANCE_SECONDS
 *   error    - downstream handler threw (likely a transient DB fault)
 */
export const stripeWebhookEventsTotal = new Counter({
  name: "stripe_webhook_events_total",
  help: "Stripe webhook events received, by terminal outcome",
  labelNames: ["status"] as const,
  registers: [],
});

/**
 * Counts HTTP tool fetches that hit their `AbortSignal.timeout`
 * ceiling. A non-zero rate from one tenant usually means a slow
 * upstream or a runaway loop in a custom tool.
 */
export const httpFetchTimeoutsTotal = new Counter({
  name: "http_fetch_timeouts_total",
  help: "HTTP tool fetches that hit their timeout",
  registers: [],
});

/**
 * Counts idle `pg.Pool` client errors (server-initiated disconnects,
 * TCP resets). The pool removes the bad client and continues; if this
 * counter is climbing, the upstream Postgres is rejecting connections
 * (DBA restart, network partition, `max_connections` exhaustion).
 */
export const dbPoolErrorsTotal = new Counter({
  name: "db_pool_errors_total",
  help: "Idle pg.Pool client errors (the pool removed the bad client)",
  registers: [],
});

/**
 * Register all AgentScope metrics into the shared registry.
 * Idempotent.
 */
export function registerAllMetrics(): void {
  const reg = getMetrics();
  const metricList: Parameters<typeof reg.registerMetric>[0][] = [
    agentRunsTotal,
    agentRunDurationSeconds,
    outboxEventsPending,
    outboxEventsDeliveredTotal,
    splunkHecSendDurationSeconds,
    splunkMcpSearchDurationSeconds,
    rateLimitRejectionsTotal,
    trpcRequestDurationSeconds,
    scheduledRunTriggersTotal,
    costBudgetBlockedTotal,
    sseConnections,
    mcpWatchdogKillsTotal,
    mcpReconnectsTotal,
    mcpInitFailuresTotal,
    stripeWebhookEventsTotal,
    httpFetchTimeoutsTotal,
    dbPoolErrorsTotal,
  ];
  for (const metric of metricList) {
    try {
      reg.registerMetric(metric);
    } catch {
      // already registered
    }
  }
}
