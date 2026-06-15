"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import type { AnomalyResult } from "@agentscope/telemetry";
import { cn } from "@agentscope/ui";

import { useTRPC } from "~/trpc/react";

const severityStyles: Record<string, string> = {
  low: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  critical: "bg-red-500/10 text-red-400 border-red-500/20",
};

const typeLabels: Record<string, string> = {
  cost_anomaly: "💰 Cost Spike",
  failure_anomaly: "❌ Failure Rate",
  hallucination_risk: "🧠 Hallucination Risk",
};

/**
 * Map an anomaly type to a pre-filled alert policy in the Settings page.
 * `cost_anomaly` is the only one with a direct counterpart in
 * `ALERT_METRICS`; the others reuse `RunFailed` since they all flag
 * agent misbehavior that should pause/notify the operator.
 */
const ALERT_PREFILL: Record<string, { metric: string; threshold: number }> = {
  cost_anomaly: { metric: "CostExceeded", threshold: 100 },
  failure_anomaly: { metric: "RunFailed", threshold: 1 },
  hallucination_risk: { metric: "RunFailed", threshold: 1 },
};

const SEVERITY_BUMP: Record<string, number> = {
  low: 1,
  medium: 3,
  high: 5,
  critical: 10,
};

function buildAlertHref(anomaly: AnomalyResult): string {
  const prefill = ALERT_PREFILL[anomaly.type] ?? {
    metric: "RunFailed",
    threshold: 1,
  };
  const bump = SEVERITY_BUMP[anomaly.severity] ?? 1;
  const params = new URLSearchParams({
    prefill_metric: prefill.metric,
    prefill_threshold: String(prefill.threshold * bump),
    prefill_name: anomaly.type.replace(/_/g, " "),
  });
  return `/settings?${params.toString()}#alerts`;
}

export function AnomalyPanel() {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(
    trpc.splunk.anomalies.queryOptions(undefined, {
      refetchInterval: 30000,
    }),
  );

  const anomalies = Array.isArray(data) ? data : [];

  return (
    <div className="bg-card border-border rounded-xl border p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Splunk Anomaly Detection</h3>
        <span className="text-muted-foreground text-xs">
          {anomalies.length > 0 ? `${anomalies.length} detected` : "All clear"}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-muted h-12 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : anomalies.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          <div className="mb-2 text-2xl">✅</div>
          No anomalies detected — all agents operating normally
        </div>
      ) : (
        <div className="space-y-2">
          {anomalies.map((anomaly: AnomalyResult, i: number) => {
            const severity = anomaly.severity;
            const type = anomaly.type;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  severityStyles[severity] ?? severityStyles.medium,
                )}
              >
                <span className="mt-0.5 text-sm">
                  {typeLabels[type] ?? "⚠️"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {typeLabels[type] ?? type}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs opacity-80">
                    {anomaly.description}
                  </p>
                  {anomaly.affectedAgent && (
                    <p className="mt-1 text-xs opacity-60">
                      Agent: {anomaly.affectedAgent}
                    </p>
                  )}
                  <Link
                    href={buildAlertHref(anomaly)}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-current/20 px-2 py-0.5 text-[10px] font-medium opacity-80 transition-opacity hover:opacity-100"
                  >
                    Create alert →
                  </Link>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                    severityStyles[severity] ?? severityStyles.medium,
                  )}
                >
                  {severity}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Splunk powered badge */}
      <div className="border-border mt-4 border-t pt-3">
        <p className="text-muted-foreground text-center text-[10px]">
          Anomaly detection powered by Splunk ML Toolkit &amp; AI
        </p>
      </div>
    </div>
  );
}
