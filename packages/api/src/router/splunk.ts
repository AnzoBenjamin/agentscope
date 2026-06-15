import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { createLogger } from "@agentscope/observability";
import {
  checkSplunkHecHealth,
  isAnomalyEnabled,
  mcpAgentEventCount,
  mcpCostByAgent,
  mcpSearch,
  runAllAnomalyChecks,
} from "@agentscope/telemetry";
import type { McpHeartbeatSample } from "@agentscope/telemetry";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

const logger = createLogger("api.splunk");

const SPLUNK_SEARCH_URL =
  process.env.SPLUNK_SEARCH_URL ??
  "https://localhost:8089/services/search/jobs";
const SPLUNK_USER = process.env.SPLUNK_USER ?? "admin";
const SPLUNK_PASSWORD = process.env.SPLUNK_PASSWORD ?? "";

/**
 * Base URL the dashboard uses to call the worker (e.g. for the
 * `/healthz` endpoint that exposes live MCP connection state). Defaults
 * to localhost on the worker's standard metrics port; in production
 * this should be set to the worker's internal DNS or a sidecar
 * address.
 */
const WORKER_METRICS_URL =
  process.env.WORKER_METRICS_URL ?? "http://localhost:9090";

async function splunkSearch(query: string): Promise<unknown> {
  ensureSplunkSearchConfigured();

  const auth = Buffer.from(`${SPLUNK_USER}:${SPLUNK_PASSWORD}`).toString(
    "base64",
  );

  const res = await fetch(`${SPLUNK_SEARCH_URL}?output_mode=json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      search: `search ${query}`,
      exec_mode: "oneshot",
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn({ status: res.status, query }, "splunk management api search failed");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Splunk search failed with ${res.status}: ${body}`,
    });
  }

  return res.json();
}

export interface WorkerMcpStatus {
  configured: boolean;
  connected: boolean;
  lastConnectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  tools: string[];
  // `null` when the worker is unreachable (API-side fallback) vs `string`
  // when the worker reported its configured `SPLUNK_URL` (empty string if
  // unset). Keeping this nullable lets the dashboard render a consistent
  // shape whether or not the worker responded.
  url: string | null;
  /**
   * Recent heartbeat attempts. Empty when the worker is unreachable
   * (we can't see its history) or when MCP was just initialized and
   * hasn't been heartbeat yet. The dashboard renders these as a small
   * sparkline to surface flapping connections before the badge flips.
   */
  heartbeatHistory: McpHeartbeatSample[];
}

export interface WorkerHealth {
  status: string;
  workerId: string;
  splunk: {
    hec: {
      enabled: boolean;
      url: string | null;
      outboxPending?: number;
      outboxFailed?: number;
      outboxDeadLettered?: number;
      outboxDelivered?: number;
      outboxRecentFailures?: {
        id: string;
        sessionId: string;
        eventType: string;
        attempts: number;
        lastError: string | null;
        updatedAt: string | null;
      }[];
    };
    mcp: WorkerMcpStatus;
  };
}

export const splunkRouter = {
  health: protectedProcedure.query(async () => {
    const hec = await checkSplunkHecHealth();
    const directSearch = {
      configured: !!SPLUNK_PASSWORD,
      url: SPLUNK_SEARCH_URL,
      ok: !!SPLUNK_PASSWORD,
      error: SPLUNK_PASSWORD
        ? undefined
        : "SPLUNK_PASSWORD is required for direct management API searches.",
    };

    // The dashboard's "MCP-enabled" badge is driven by the worker's
    // live connection state, not by a static config flag or a probe from
    // (the potentially serverless) Next.js process. The Next.js process
    // can still *talk* to MCP for ad-hoc searches (see `mcpSearch`),
    // but the readiness panel reads from the worker so operators see
    // the same connection that powers the investigator.
    const mcpFromWorker = await fetchWorkerHealth();
    // Explicit type annotation: the `??` fallback object would
    // otherwise be inferred with `tools: never[]` and `url: string`,
    // widening the union and breaking downstream inference in the
    // dashboard's `splunk-health-panel.tsx` (eslint
    // `no-unsafe-member-access`).
    const mcp: WorkerMcpStatus = mcpFromWorker?.splunk.mcp ?? {
      configured: process.env.SPLUNK_MCP_ENABLED === "true",
      connected: false,
      lastError: mcpFromWorker
        ? null
        : "Worker is not reachable; MCP readiness unknown.",
      tools: [],
      lastConnectedAt: null,
      lastHeartbeatAt: null,
      url: process.env.SPLUNK_URL ?? null,
      heartbeatHistory: [],
    };

    return {
      ready: hec.ok && mcp.connected,
      hec,
      directSearch,
      mcp,
      // Outbox state is sourced from the worker's `/healthz` so the
      // dashboard can spot a silent HEC outage (worker keeps draining
      // pending events but Splunk rejects them) without conflating it
      // with the Next.js process's own HEC health probe.
      outbox: mcpFromWorker?.splunk.hec
        ? {
            pending: mcpFromWorker.splunk.hec.outboxPending ?? 0,
            failed: mcpFromWorker.splunk.hec.outboxFailed ?? 0,
            deadLettered: mcpFromWorker.splunk.hec.outboxDeadLettered ?? 0,
            delivered: mcpFromWorker.splunk.hec.outboxDelivered ?? 0,
            recentFailures:
              mcpFromWorker.splunk.hec.outboxRecentFailures ?? [],
          }
        : null,
      worker: mcpFromWorker
        ? {
            reachable: true,
            workerId: mcpFromWorker.workerId,
          }
        : { reachable: false, workerId: null },
      anomalyDetection: {
        configured: isAnomalyEnabled(),
      },
    };
  }),

  /**
   * Raw worker readiness payload. Exposed separately so the dashboard
   * can render a "Worker unreachable" state without conflating it with
   * "MCP is broken". Returns the same shape as the worker's `/healthz`
   * endpoint, with `null` when the worker is not reachable.
   */
  workerHealth: protectedProcedure.query(async () => {
    const worker = await fetchWorkerHealth();
    if (!worker) {
      return {
        reachable: false,
        workerId: null,
        error: `Could not reach worker at ${WORKER_METRICS_URL}/healthz`,
      };
    }
    // Don't spread `worker` here — it already contains `workerId` and
    // we want the top-level `workerId` field to be the canonical
    // source for the dashboard.
    return {
      reachable: true,
      workerId: worker.workerId,
      status: worker.status,
      splunk: worker.splunk,
    };
  }),

  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return splunkSearch(input.query);
    }),

  agentEventCount: protectedProcedure.query(async () => {
    return splunkSearch(
      "index=main sourcetype=agentscope:event | stats count by eventType",
    );
  }),

  costByAgent: protectedProcedure.query(async () => {
    return splunkSearch(
      "index=main sourcetype=agentscope:event eventType=CostRecorded | stats sum(cost) by agentName",
    );
  }),

  /** Search via Splunk MCP Server */
  mcpSearch: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return mcpSearch(input.query);
    }),

  /** Agent event counts via MCP */
  mcpAgentEventCount: protectedProcedure.query(async () => {
    return mcpAgentEventCount();
  }),

  /** Cost per agent via MCP */
  mcpCostByAgent: protectedProcedure.query(async () => {
    return mcpCostByAgent();
  }),

  /** Run all anomaly detection checks (cost, failure, hallucination) */
  anomalies: protectedProcedure.query(async () => {
    if (!isAnomalyEnabled()) {
      return [];
    }

    return runAllAnomalyChecks();
  }),
} satisfies TRPCRouterRecord;

function ensureSplunkSearchConfigured() {
  if (!SPLUNK_PASSWORD) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "SPLUNK_PASSWORD is required for direct Splunk searches.",
    });
  }
}

async function fetchWorkerHealth(): Promise<WorkerHealth | null> {
  // Note: we intentionally do NOT read `isMcpEnabled()` here — the
  // API process's MCP cache is independent of the worker's. The
  // worker is the source of truth for the readiness badge.
  try {
    const res = await fetch(`${WORKER_METRICS_URL}/healthz`, {
      // Tight timeout so the dashboard badge degrades to "Worker
      // unreachable" instead of hanging the query for the worker's
      // heartbeat cadence.
      signal: AbortSignal.timeout(3000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, url: `${WORKER_METRICS_URL}/healthz` },
        "worker /healthz returned non-2xx",
      );
      return null;
    }
    return (await res.json()) as WorkerHealth;
  } catch (error) {
    // Most common: the worker hasn't started, or is on a different
    // host in production. Either way, the dashboard should fall back
    // to "Worker unreachable" rather than masking the issue.
    logger.debug(
      { err: error, url: `${WORKER_METRICS_URL}/healthz` },
      "worker /healthz unreachable",
    );
    return null;
  }
}
