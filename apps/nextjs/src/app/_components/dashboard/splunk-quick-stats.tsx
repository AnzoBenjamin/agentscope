"use client";

import { useQuery } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";

import { useTRPC } from "~/trpc/react";
import { BarChart } from "./charts";

/**
 * Quick stats panels backed by the Splunk event/cost aggregation queries
 * (direct management API + MCP). Each panel degrades gracefully when the
 * query fails so the rest of the dashboard keeps rendering.
 */
export function SplunkQuickStats({ className }: { className?: string }) {
  const trpc = useTRPC();
  const directEventCount = useQuery(
    trpc.splunk.agentEventCount.queryOptions(undefined, {
      retry: false,
    }),
  );
  const directCostByAgent = useQuery(
    trpc.splunk.costByAgent.queryOptions(undefined, {
      retry: false,
    }),
  );
  const mcpEventCount = useQuery(
    trpc.splunk.mcpAgentEventCount.queryOptions(undefined, {
      retry: false,
    }),
  );
  const mcpCostByAgent = useQuery(
    trpc.splunk.mcpCostByAgent.queryOptions(undefined, {
      retry: false,
    }),
  );

  return (
    <section className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <StatPanel
        title="Events by Type (Direct)"
        data={parseSplunkRows(directEventCount.data)}
        emptyMessage={
          directEventCount.error
            ? "Splunk direct search unavailable"
            : "No events indexed yet."
        }
        loading={directEventCount.isLoading}
      />
      <StatPanel
        title="Events by Type (MCP)"
        data={parseSplunkRows(mcpEventCount.data)}
        emptyMessage={
          mcpEventCount.error
            ? "Splunk MCP unavailable"
            : "No events indexed yet."
        }
        loading={mcpEventCount.isLoading}
      />
      <StatPanel
        title="Cost by Agent (Direct)"
        data={parseSplunkRows(directCostByAgent.data)}
        formatValue={(v) => `$${v.toFixed(4)}`}
        emptyMessage={
          directCostByAgent.error
            ? "Splunk direct search unavailable"
            : "No cost events yet."
        }
        loading={directCostByAgent.isLoading}
      />
      <StatPanel
        title="Cost by Agent (MCP)"
        data={parseSplunkRows(mcpCostByAgent.data)}
        formatValue={(v) => `$${v.toFixed(4)}`}
        emptyMessage={
          mcpCostByAgent.error
            ? "Splunk MCP unavailable"
            : "No cost events yet."
        }
        loading={mcpCostByAgent.isLoading}
      />
    </section>
  );
}

function StatPanel({
  title,
  data,
  formatValue,
  emptyMessage,
  loading,
}: {
  title: string;
  data: { label: string; value: number }[];
  formatValue?: (value: number) => string;
  emptyMessage: string;
  loading: boolean;
}) {
  const valueFormatter = formatValue ?? ((v: number) => String(v));
  return (
    <div className="bg-card border-border rounded-xl border p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {loading ? (
        <div className="bg-muted mt-4 h-24 animate-pulse rounded-md" />
      ) : data.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-xs">{emptyMessage}</p>
      ) : (
        <div className="mt-4">
          <BarChart
            data={data.slice(0, 6).map((d) => ({
              label: d.label,
              value: d.value,
              color: "bg-primary",
              displayValue: valueFormatter(d.value),
            }))}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The Splunk management API returns results in a `results` envelope
 * (`{ results: [{eventType, count}, ...] }`). Older queries may also
 * return a bare array. This normalises both into a flat row list keyed
 * by the requested field.
 */
function parseSplunkRows(payload: unknown): {
  label: string;
  value: number;
}[] {
  if (!payload) return [];
  const rows = extractRows(payload);
  if (rows.length === 0) return [];

  // Use the first row to discover the field names.
  const first = rows[0] as Record<string, unknown>;
  const labelKey = pickField(first, [
    "eventType",
    "agentName",
    "label",
    "name",
    "host",
  ]);
  const valueKey = pickField(first, [
    "count",
    "sum",
    "total",
    "value",
    "sum(cost)",
  ]);

  if (!labelKey || !valueKey) {
    return rows.slice(0, 6).map((row, i) => {
      const record = row as Record<string, unknown>;
      const firstKey = Object.keys(record)[0];
      const secondKey = Object.keys(record)[1] ?? firstKey;
      return {
        label: coerceLabel(record[firstKey ?? ""], `Row ${i + 1}`),
        value: Number(record[secondKey ?? ""] ?? 0),
      };
    });
  }

  return rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        label: coerceLabel(record[labelKey], "—"),
        value: Number(record[valueKey] ?? 0),
      };
    })
    .sort((a, b) => b.value - a.value);
}

function coerceLabel(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.results)) return record.results;
    if (Array.isArray(record.rows)) return record.rows;
    if (Array.isArray(record.data)) return record.data;
  }
  return [];
}

function pickField(
  record: Record<string, unknown>,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    if (candidate in record) return candidate;
  }
  return null;
}
