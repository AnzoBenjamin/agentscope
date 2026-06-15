"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";

import { useTRPC } from "~/trpc/react";

/**
 * Recent org-wide activity feed. Polls the `stream.recent` query on a short
 * interval so the UI reflects new `agent_run.*`, `telemetry.event`, and
 * `alert.delivered` rows within a few seconds. Rows that are present in
 * the `since` window are subtly highlighted so newly-arrived events
 * stand out from the historical tail.
 */
export function LiveActivityFeed({
  className,
}: {
  className?: string;
}) {
  const trpc = useTRPC();
  const [pollMs, setPollMs] = useState(5000);
  const { data: events = [] } = useQuery({
    ...trpc.stream.recent.queryOptions({ limit: 25 }),
    refetchInterval: pollMs,
  });
  const { data: sinceEvents = [] } = useQuery({
    ...trpc.stream.since.queryOptions({ sinceMs: pollMs * 4 }),
    refetchInterval: pollMs,
  });

  const merged = mergeUnique([...sinceEvents, ...events]);
  const sinceIds = new Set(sinceEvents.map((s) => s.id));

  return (
    <div
      className={cn(
        "bg-card border-border rounded-xl border p-6",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Live Activity</h2>
          <p className="text-muted-foreground text-xs">
            Polling the stream every {Math.round(pollMs / 1000)}s ·{" "}
            {merged.length} recent events
          </p>
        </div>
        <select
          value={pollMs}
          onChange={(event) => setPollMs(Number(event.target.value))}
          className="bg-background border-border h-9 rounded-md border px-2 text-xs"
          aria-label="Polling interval"
        >
          <option value={2000}>2s</option>
          <option value={5000}>5s</option>
          <option value={10000}>10s</option>
          <option value={30000}>30s</option>
        </select>
      </div>

      {merged.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          No recent activity. The stream will populate as agents run, alerts
          fire, and telemetry is forwarded to Splunk.
        </p>
      ) : (
        <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
          {merged.map((evt) => (
            <li
              key={evt.id}
              className={cn(
                "border-border/60 flex items-start justify-between gap-3 border-b pb-2 text-sm transition-colors",
                sinceIds.has(evt.id) && "bg-emerald-500/5",
              )}
            >
              <div className="min-w-0 flex-1">
                <EventLink
                  eventType={evt.eventType}
                  resourceType={evt.resourceType}
                  resourceId={evt.resourceId}
                />
                <p className="text-muted-foreground text-xs">
                  {new Date(evt.createdAt).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventLink({
  eventType,
  resourceType,
  resourceId,
}: {
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
}) {
  const className = cn(
    "font-mono text-xs",
    EVENT_COLOR[eventType] ?? "text-foreground",
  );

  if (!resourceType || !resourceId) {
    return <span className={className}>{eventType}</span>;
  }

  const href = hrefForResource(resourceType, resourceId);
  if (!href) {
    return <span className={className}>{eventType}</span>;
  }

  return (
    <Link href={href} className={cn(className, "hover:underline")}>
      {eventType} · {resourceType}/{resourceId.slice(0, 8)}
    </Link>
  );
}

const EVENT_COLOR: Record<string, string> = {
  "agent_run.completed": "text-emerald-400",
  "agent_run.started": "text-sky-400",
  "agent_run.created": "text-sky-400",
  "agent_run.failed": "text-red-400",
  "agent_run.cancelled": "text-amber-400",
  "agent_run.dead_lettered": "text-red-500",
  "agent_session.started": "text-cyan-400",
  "agent_session.completed": "text-cyan-400",
  "agent_session.failed": "text-red-400",
  "telemetry.event": "text-indigo-400",
  "alert.delivered": "text-purple-400",
  "cost.recorded": "text-yellow-400",
  "splunk.investigation.completed": "text-cyan-400",
};

function hrefForResource(
  resourceType: string,
  resourceId: string,
): string | null {
  switch (resourceType) {
    case "agent":
      return `/agents/${resourceId}`;
    case "agent_run":
      return `/runs/${resourceId}`;
    case "agent_session":
      return `/sessions/${resourceId}`;
    case "agent_schedule":
      return `/schedules/${resourceId}`;
    default:
      return null;
  }
}

function mergeUnique<T extends { id: string; createdAt: Date | string | null }>(
  items: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out.sort(
    (a, b) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  );
}
