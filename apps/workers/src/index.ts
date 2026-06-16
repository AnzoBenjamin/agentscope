import http from "node:http";

import {
  evaluateOperationalAlerts,
  executeNextAgentRun,
  reapStaleAgentRuns,
  triggerDueSchedules,
} from "@agentscope/agents";
import { closeDb, db } from "@agentscope/db/client";
import {
  createLogger,
  initMetrics,
  registerAllMetrics,
  serializeMetrics,
} from "@agentscope/observability";
import {
  disconnectSplunkMcp,
  getMcpStatus,
  getTelemetryOutboxHealth,
  initOpenTelemetry,
  initSplunkMcp,
  isMcpEnabled,
  isSplunkEnabled,
  mcpHeartbeat,
  processTelemetryOutboxBatch,
  reapStaleTelemetryOutbox,
} from "@agentscope/telemetry";

const logger = createLogger("workers");
process.env.AGENTSCOPE_SERVICE_NAME ??= "agentscope-workers";

const pollMs = Number(process.env.AGENTSCOPE_WORKER_POLL_MS ?? 5000);
const operationalAlertPollMs = Number(
  process.env.AGENTSCOPE_OPERATIONAL_ALERT_POLL_MS ?? 60_000,
);
const telemetryOutboxPollMs = Number(
  process.env.AGENTSCOPE_TELEMETRY_OUTBOX_POLL_MS ?? 2500,
);
const telemetryOutboxReapMs = Number(
  process.env.AGENTSCOPE_TELEMETRY_OUTBOX_REAP_MS ?? 60_000,
);
const agentRunReapMs = Number(process.env.AGENTSCOPE_AGENT_RUN_REAP_MS ?? 60_000);
const schedulePollMs = Number(
  process.env.AGENTSCOPE_SCHEDULE_POLL_MS ?? 30_000,
);
// Cadence at which the worker pings the Splunk MCP server so the
// dashboard's "MCP-enabled" badge reflects a live connection rather than a
// stale `SPLUNK_MCP_ENABLED=true` flag. Defaults to 30s; set to 0 to
// disable heartbeats (e.g. when MCP is intentionally not configured).
const mcpHeartbeatMs = Number(
  process.env.AGENTSCOPE_MCP_HEARTBEAT_MS ?? 30_000,
);
const metricsPort = Number(process.env.AGENTSCOPE_METRICS_PORT ?? 9090);
const workerId =
  process.env.AGENTSCOPE_WORKER_ID ?? `agentscope-worker-${process.pid}`;

let shuttingDown = false;
let shutdownResolve: (() => void) | null = null;
/**
 * Tracks the in-flight `executeNextAgentRun` call so the shutdown
 * handler can wait for it to drain before exiting. Without this, a
 * SIGTERM mid-run would interrupt the LLM call (potentially
 * mid-stream) and orphan the `AgentRun` row in `Running` status until
 * the next reaper tick picks it up. We also track the iteration
 * promise for the main loop so `await shutdownCompleted` doesn't race
 * a pending `sleep(pollMs)`.
 *
 * The promise is typed to the actual return type of
 * `executeNextAgentRun` (an `AgentRun` summary or `null` when the
 * queue is empty) so the `run.id` / `run.status` accesses in the
 * completion log compile without `unknown` or `any` casts.
 */
type AgentRunResult = Awaited<ReturnType<typeof executeNextAgentRun>>;
let currentRunPromise: Promise<AgentRunResult> = Promise.resolve(
  null as AgentRunResult,
);
let currentLoopPromise: Promise<unknown> = Promise.resolve();
let nextOperationalAlertCheckAt = 0;
let nextTelemetryOutboxCheckAt = 0;
let nextTelemetryOutboxReapAt = 0;
let nextAgentRunReapAt = 0;
let nextScheduleCheckAt = 0;
let nextMcpHeartbeatAt = 0;
let metricsServer: http.Server | null = null;

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception");
  shutdown();
});

initMetrics();
registerAllMetrics();
void initOpenTelemetry();

// Establish the Splunk MCP connection eagerly so the dashboard's
// "MCP-enabled" badge reflects a real, currently-open connection from the
// moment the worker is up. We do not block startup on it: a missing
// splunk-mcp-server binary should not stop the worker from processing
// agent runs. `getMcpStatus()` (used by the /healthz endpoint) reports
// the outcome.
void (async () => {
  try {
    await initSplunkMcp();
    if (isMcpEnabled()) {
      logger.info(
        { tools: getMcpStatus().tools },
        "splunk mcp connected at startup",
      );
    } else {
      logger.warn(
        { error: getMcpStatus().lastError },
        "splunk mcp not connected at startup; investigator falls back to direct search",
      );
    }
  } catch (error) {
    logger.error({ err: error }, "splunk mcp init threw at startup");
  }
})();

startMetricsServer();

logger.info(
  {
    workerId,
    pollMs,
    hecEnabled: isSplunkEnabled(),
    mcpConfigured: getMcpStatus().configured,
  },
  "workers started; polling queued agent runs",
);

currentLoopPromise = (async () => {
  while (!shuttingDown) {
    try {
      if (Date.now() >= nextScheduleCheckAt) {
        nextScheduleCheckAt = Date.now() + schedulePollMs;
        await triggerDueSchedules({ db });
      }

      if (Date.now() >= nextOperationalAlertCheckAt) {
        nextOperationalAlertCheckAt = Date.now() + operationalAlertPollMs;
        await evaluateOperationalAlerts(db);
      }

      if (Date.now() >= nextTelemetryOutboxReapAt) {
        nextTelemetryOutboxReapAt = Date.now() + telemetryOutboxReapMs;
        await reapStaleTelemetryOutbox({ db });
      }

      if (Date.now() >= nextAgentRunReapAt) {
        nextAgentRunReapAt = Date.now() + agentRunReapMs;
        const staleRuns = await reapStaleAgentRuns({ db, workerId });
        if (staleRuns.reaped > 0) {
          logger.info(
            { reaped: staleRuns.reaped },
            "reaped stale agent runs",
          );
        }
      }

      if (Date.now() >= nextTelemetryOutboxCheckAt) {
        nextTelemetryOutboxCheckAt = Date.now() + telemetryOutboxPollMs;
        const outbox = await processTelemetryOutboxBatch({
          db,
          workerId,
          limit: 50,
        });
        if (outbox.processed > 0) {
          logger.debug(
            { processed: outbox.processed },
            "delivered telemetry events",
          );
        }
      }

      if (mcpHeartbeatMs > 0 && Date.now() >= nextMcpHeartbeatAt) {
        nextMcpHeartbeatAt = Date.now() + mcpHeartbeatMs;
        // Fire-and-forget: a transient MCP blip must never block the run
        // loop. `mcpHeartbeat()` updates `getMcpStatus()` synchronously
        // (lastHeartbeatAt, lastError, connected) so the /healthz endpoint
        // and the dashboard's MCP badge reflect the latest state.
        void mcpHeartbeat().catch((error) => {
          logger.warn({ err: error }, "mcp heartbeat threw");
        });
      }

      // Track the in-flight run so the shutdown handler can await it.
      // `executeNextAgentRun` resolves to the run summary on completion
      // (or to null when the queue is empty); either way the await
      // blocks the loop iteration until the LLM stream finishes.
      currentRunPromise = executeNextAgentRun({ workerId });

      const run = await currentRunPromise;
      // Reset to a settled null-promise so the shutdown handler
      // awaiting `currentRunPromise` doesn't see the in-flight run
      // twice. Typed cast keeps the `Promise<AgentRunResult>` invariant
      // (the variable was widened to `Promise<AgentRunRecord | null>`
      // after the explicit return-type fix on `executeNextAgentRun`).
      currentRunPromise = Promise.resolve(null as AgentRunResult);

      if (run) {
        logger.info(
          { runId: run.id, status: run.status, error: run.error },
          "agent run completed",
        );
        continue;
      }
    } catch (error) {
      logger.error(
        { err: error },
        "agent run processing failed",
      );
      // Same null-promise reset as the success path: the previous
      // run-promise was either fulfilled (and replaced above) or it
      // rejected (and we just logged the error). Either way, the
      // shutdown drain should not see a stale handle.
      currentRunPromise = Promise.resolve(null as AgentRunResult);
    }

    // Cooperative sleep: bail out immediately on shutdown so we don't
    // wait `pollMs` (5s by default) before the graceful-exit path runs.
    if (shuttingDown) break;
    await sleep(pollMs);
  }

  logger.info({ workerId }, "workers stopped");
  // The `let` is assigned by the `shutdown()` handler in a separate
  // function scope; TypeScript's control-flow analysis can narrow
  // `shutdownResolve` to `null` (its initial value) when the loop
  // exits without seeing the assignment. The cast preserves the
  // `(() => void) | null` invariant so `?.()` stays valid.
  (shutdownResolve as (() => void) | null)?.();
})();

/**
 * Hard ceiling for the graceful-shutdown window. Kubernetes sends
 * SIGTERM, then SIGKILLs the container after `terminationGracePeriod`
 * (default 30s); the in-process cap is a few seconds shorter so we
 * have a chance to close the DB pool and disconnect the MCP child
 * before the kernel reaps us. Bump via `AGENTSCOPE_SHUTDOWN_TIMEOUT_MS`
 * for slower environments.
 */
const SHUTDOWN_TIMEOUT_MS = Number(
  process.env.AGENTSCOPE_SHUTDOWN_TIMEOUT_MS ?? 25_000,
);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(
    { workerId, timeoutMs: SHUTDOWN_TIMEOUT_MS },
    "shutdown signal received; draining",
  );
  // Stop accepting new /metrics and /healthz probes. The dashboard will
  // start showing the worker as unhealthy, which is the correct signal
  // to operators that the worker is going down. `server.close()` is
  // async and resolves once all keep-alive connections are closed, so
  // we schedule the `await` after the loop exits.
  metricsServer?.close();

  // Hard timeout: if the current run or the loop never finishes (e.g.
  // an LLM provider that hangs forever), we still want to exit before
  // SIGKILL. `process.exit` is sync so the timers below are best-effort.
  const forceExit = setTimeout(() => {
    logger.fatal(
      { timeoutMs: SHUTDOWN_TIMEOUT_MS },
      "shutdown timed out; forcing exit",
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // Drain the run loop + any in-flight agent run, then release all
  // external handles. Each step is independently best-effort — we
  // want to attempt DB + MCP teardown even if the loop throws.
  void (async () => {
    const shutdownCompleted = new Promise<void>((resolve) => {
      shutdownResolve = resolve;
    });
    try {
      await currentLoopPromise;
      await currentRunPromise;
    } catch (error) {
      logger.warn({ err: error }, "shutdown drain threw");
    }
    try {
      await closeDb();
    } catch (error) {
      logger.warn({ err: error }, "closeDb threw during shutdown");
    }
    try {
      disconnectSplunkMcp();
    } catch (error) {
      logger.warn({ err: error }, "disconnectSplunkMcp threw during shutdown");
    }
    try {
      await shutdownCompleted;
    } catch {
      // already resolved
    }
    clearTimeout(forceExit);
    logger.info({ workerId }, "workers stopped");
    process.exit(0);
  })();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startMetricsServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics" || req.url === "/metrics/") {
      try {
        const body = await serializeMetrics();
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
        res.end(body);
      } catch (error) {
        res.writeHead(500);
        res.end(`metrics error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (req.url === "/healthz" || req.url === "/healthz/") {
      // Detailed readiness payload: the dashboard's "MCP-enabled" badge
      // is driven from `mcp.connected` here, so it reflects a real
      // connection that this worker has verified, not a static config
      // flag. The Next.js tRPC layer proxies this via `splunk.workerHealth`.
      const mcp = getMcpStatus();
      // Outbox health is computed lazily on every probe — a stuck
      // outbox is the symptom of "the worker is running, MCP is green,
      // but every event silently fails to reach Splunk", which the
      // previous payload hid. Reading on every request keeps the
      // dashboard's surface fresh without adding a separate polling
      // cadence.
      const outbox = await getTelemetryOutboxHealth({ db });
      const payload = {
        status: "ok",
        workerId,
        splunk: {
          hec: {
            enabled: isSplunkEnabled(),
            url: process.env.SPLUNK_HEC_URL ?? null,
            // `outbox.pending` is the leading indicator of an HEC
            // outage: if HEC is reachable, the worker drains the outbox
            // every `AGENTSCOPE_TELEMETRY_OUTBOX_POLL_MS` (2.5s) so
            // pending should stay near zero. A persistently non-zero
            // pending count means HEC is rejecting or timing out.
            outboxPending: outbox.pending,
            outboxFailed: outbox.failed,
            outboxDeadLettered: outbox.deadLettered,
            outboxDelivered: outbox.delivered,
            outboxRecentFailures: outbox.recentFailures,
          },
          mcp: {
            configured: mcp.configured,
            connected: mcp.connected,
            lastConnectedAt: mcp.lastConnectedAt,
            lastHeartbeatAt: mcp.lastHeartbeatAt,
            lastError: mcp.lastError,
            tools: mcp.tools,
            url: mcp.url,
            // Forward the worker's local heartbeat ring buffer so the
            // dashboard can render a sparkline of recent connection
            // attempts. `getMcpStatus()` already returns a defensive
            // copy, so serializing it is safe.
            heartbeatHistory: mcp.heartbeatHistory,
          },
        },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(metricsPort, () => {
    logger.info({ port: metricsPort }, "metrics endpoint listening");
  });
  metricsServer = server;
}
