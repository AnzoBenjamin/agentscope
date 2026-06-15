"use client";

import { useQuery } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";

import { useTRPC } from "~/trpc/react";

/**
 * Splunk readiness panel.
 *
 * Source of truth: the worker's `/healthz` endpoint, proxied through the
 * `splunk.health` tRPC procedure. The worker is the long-running process
 * that owns the Splunk MCP connection (the investigator calls MCP from
 * the worker, not from the Next.js server), so its heartbeat is the most
 * honest "MCP-enabled" signal the dashboard can show. The Next.js
 * process can still run ad-hoc MCP searches via `splunk.mcpSearch` and
 * the quick-stats widgets; only the readiness badge is worker-driven.
 */
export function SplunkHealthPanel() {
  const trpc = useTRPC();
  const { data: health, error, isLoading } = useQuery(
    trpc.splunk.health.queryOptions(undefined, {
      refetchInterval: 15000,
      retry: false,
    }),
  );

  if (isLoading) {
    return (
      <div className="bg-card border-border rounded-xl border p-6">
        <div className="bg-muted h-5 w-40 animate-pulse rounded-md" />
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="bg-muted h-16 animate-pulse rounded-lg"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Splunk Readiness</h2>
        <p className="text-destructive mt-2 text-sm">
          {error?.message ?? "Unable to load Splunk health."}
        </p>
      </div>
    );
  }

  const mcpDetail = (() => {
    if (!health.worker.reachable) {
      return "Worker unreachable; the long-lived process that owns the MCP connection is not responding on its metrics port.";
    }
    if (!health.mcp.configured) {
      return "SPLUNK_MCP_ENABLED is not true. Set it in the worker's environment to enable MCP-driven investigation.";
    }
    if (health.mcp.connected) {
      const since = formatRelativeTime(health.mcp.lastHeartbeatAt);
      const toolCount = health.mcp.tools.length;
      const toolSummary = toolCount > 0 ? `${toolCount} tools` : "no tools";
      return `Connected — ${toolSummary}${since ? `, heartbeat ${since}` : ""}`;
    }
    return health.mcp.lastError ?? "MCP client is not connected.";
  })();

  // Flapping detector: at least 2 failures in the last 6 attempts but
  // NOT all failures (a hard outage is just a hard outage, not
  // flapping). Only meaningful when MCP is configured AND the badge
  // is still green — that's exactly the case where an operator needs
  // a nudge to investigate the Splunk MCP server logs.
  const flapping = (() => {
    if (!health.mcp.configured || !health.mcp.connected) return null;
    const recent = health.mcp.heartbeatHistory.slice(-6);
    if (recent.length < 4) return null;
    const failures = recent.filter((s) => !s.ok).length;
    if (failures >= 2 && failures <= recent.length - 1) {
      return { failures, total: recent.length };
    }
    return null;
  })();

  const checks = [
    {
      label: "HEC",
      ok: health.hec.ok,
      detail: health.hec.error ?? `HTTP ${health.hec.status ?? "OK"}`,
    },
    {
      label: "MCP",
      ok: health.mcp.connected,
      detail: mcpDetail,
    },
    {
      label: "Direct Search",
      ok: health.directSearch.ok,
      detail: health.directSearch.error ?? "Configured",
    },
    {
      label: "Anomaly Checks",
      ok: health.anomalyDetection.configured,
      detail: health.anomalyDetection.configured
        ? "Configured"
        : "Optional env not configured",
    },
  ];

  // Outbox indicator — surfaces a silent HEC outage that would
  // otherwise look fine because the worker is up and MCP is connected.
  // A persistently non-zero pending count (or any dead-lettered
  // events) means HEC is rejecting or timing out, and the Splunk
  // investigator will return zero rows for new sessions.
  const outbox = health.outbox;
  const outboxState = (() => {
    if (!outbox) {
      return {
        ok: false,
        label: "Unknown",
        detail: health.worker.reachable
          ? "Outbox snapshot unavailable"
          : "Worker unreachable",
      };
    }
    if (outbox.deadLettered > 0) {
      return {
        ok: false,
        label: `${outbox.pending} pending, ${outbox.deadLettered} dead-lettered`,
        detail: `${outbox.delivered} delivered; the most recent failure: ${outbox.recentFailures[0]?.lastError ?? "unknown error"}`,
      };
    }
    if (outbox.failed > 0 || outbox.pending > 0) {
      return {
        ok: false,
        label: `${outbox.pending} pending, ${outbox.failed} retrying`,
        detail: `${outbox.delivered} delivered; transient delivery errors are being retried.`,
      };
    }
    return {
      ok: true,
      label: `Healthy (${outbox.delivered} delivered)`,
      detail: "HEC outbox is fully drained.",
    };
  })();

  return (
    <div className="bg-card border-border rounded-xl border p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Splunk Readiness</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Runtime checks for event ingestion, MCP search, and analytics —
            MCP status reflects the worker&apos;s live connection.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "inline-flex w-fit items-center rounded-md border px-2 py-1 text-xs font-semibold",
              health.ready
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : health.worker.reachable
                  ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                  : "border-red-500/20 bg-red-500/10 text-red-400",
            )}
          >
            {health.ready
              ? "Ready"
              : health.worker.reachable
                ? "Needs Setup"
                : "Worker Offline"}
          </span>
          {health.worker.workerId ? (
            <span className="text-muted-foreground text-[10px]">
              worker: {health.worker.workerId}
            </span>
          ) : null}
        </div>
      </div>
      {health.mcp.configured ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
            Last heartbeat:{" "}
            {health.mcp.lastHeartbeatAt ? (
              <span className="text-foreground/80 font-mono normal-case">
                {formatRelativeTime(health.mcp.lastHeartbeatAt) ?? "just now"}
              </span>
            ) : (
              <span className="text-muted-foreground font-mono normal-case">
                never
              </span>
            )}
          </p>
          <McpHeartbeatSparkline samples={health.mcp.heartbeatHistory} />
          {flapping ? (
            <p
              role="status"
              data-testid="mcp-flapping"
              className="border-amber-500/20 bg-amber-500/10 text-amber-400 rounded-md border px-2 py-1.5 text-[11px] leading-snug"
            >
              MCP connection has been flapping — {flapping.failures} failed
              heartbeats in the last {flapping.total} attempts. The badge is
              still green because the most recent attempt succeeded, but
              check the Splunk MCP server logs.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {checks.map((check) => (
          <div
            key={check.label}
            className="border-border rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{check.label}</p>
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  check.ok ? "bg-emerald-400" : "bg-amber-400",
                )}
              />
            </div>
            <p className="text-muted-foreground mt-2 line-clamp-3 text-xs">
              {check.detail}
            </p>
          </div>
        ))}
      </div>
      <div
        data-testid="outbox-state"
        className={cn(
          "mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
          outboxState.ok
            ? "border-emerald-500/20 bg-emerald-500/5"
            : "border-amber-500/20 bg-amber-500/5",
        )}
      >
        <div>
          <p className="text-xs font-semibold">
            Telemetry Outbox: {outboxState.label}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            {outboxState.detail}
          </p>
        </div>
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            outboxState.ok ? "bg-emerald-400" : "bg-amber-400",
          )}
        />
      </div>
      {health.mcp.connected && health.mcp.tools.length > 0 ? (
        <div className="mt-4">
          <p className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
            MCP tools available
          </p>
          <div className="flex flex-wrap gap-1.5">
            {health.mcp.tools.slice(0, 12).map((tool) => (
              <span
                key={tool}
                className="border-border bg-muted/40 rounded border px-2 py-0.5 text-[10px] font-mono"
              >
                {tool}
              </span>
            ))}
            {health.mcp.tools.length > 12 ? (
              <span className="text-muted-foreground px-1 py-0.5 text-[10px]">
                +{health.mcp.tools.length - 12} more
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Format an ISO timestamp as a human-readable relative duration
 * (e.g. "12s ago"). Returns null when the timestamp is missing so the
 * caller can omit the suffix entirely.
 */
function formatRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) return "in the future";
  if (deltaMs < 1000) return "just now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Shape of one heartbeat attempt in the worker's ring buffer. Defined
 * locally (not imported from @agentscope/telemetry) to avoid pulling
 * the server-only MCP client into the client bundle — the type is
 * erased at compile time but the bundler would still try to resolve
 * the module path.
 */
interface McpHeartbeatSample {
  at: string;
  ok: boolean;
  error: string | null;
  durationMs: number;
}

const SPARK_BAR_WIDTH = 4;
const SPARK_BAR_GAP = 1;
const SPARK_HEIGHT = 24;
const SPARK_OK_COLOR = "#34d399";
const SPARK_FAIL_COLOR = "#f87171";
const SPARK_TRACK_COLOR = "#3f3f46";
const SPARK_OK_BAR_HEIGHT = 16;
const SPARK_FAIL_BAR_HEIGHT = 8;

/**
 * Inline-SVG sparkline of recent MCP heartbeat attempts. Renders one
 * bar per sample (oldest left, newest right). Success bars are taller
 * and green; failure bars are shorter and red so a flapping connection
 * is visible at a glance even before the readiness badge flips. Each
 * bar has a native `<title>` tooltip with the ISO timestamp and, for
 * failures, the error message.
 */
function McpHeartbeatSparkline({
  samples,
}: {
  samples: McpHeartbeatSample[];
}) {
  if (samples.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
        <span
          className="inline-block rounded-sm"
          style={{
            width: 120,
            height: 4,
            backgroundColor: SPARK_TRACK_COLOR,
          }}
        />
        <span>no samples yet</span>
      </div>
    );
  }

  const barStride = SPARK_BAR_WIDTH + SPARK_BAR_GAP;
  const width = samples.length * barStride - SPARK_BAR_GAP;

  return (
    <svg
      role="img"
      aria-label={`MCP heartbeat: ${samples.length} recent attempts`}
      width={width}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${width} ${SPARK_HEIGHT}`}
      className="block"
    >
      {samples.map((sample, index) => {
        const x = index * barStride;
        const y =
          SPARK_HEIGHT -
          (sample.ok ? SPARK_OK_BAR_HEIGHT : SPARK_FAIL_BAR_HEIGHT);
        const height = sample.ok
          ? SPARK_OK_BAR_HEIGHT
          : SPARK_FAIL_BAR_HEIGHT;
        const fill = sample.ok ? SPARK_OK_COLOR : SPARK_FAIL_COLOR;
        const tooltip = sample.ok
          ? `${sample.at} — ok (${sample.durationMs}ms)`
          : `${sample.at} — failed (${sample.durationMs}ms): ${sample.error ?? "unknown error"}`;
        return (
          <rect
            key={`${sample.at}-${index}`}
            x={x}
            y={y}
            width={SPARK_BAR_WIDTH}
            height={height}
            rx={1}
            fill={fill}
          >
            <title>{tooltip}</title>
          </rect>
        );
      })}
    </svg>
  );
}
