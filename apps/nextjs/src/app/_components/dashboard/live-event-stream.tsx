"use client";

import { useEventStream } from "~/lib/use-event-stream";

interface LiveEventStreamProps {
  organizationId: string;
  className?: string;
}

const STATUS_COLOR: Record<string, string> = {
  "agent_run.completed": "text-emerald-400",
  "agent_run.started": "text-sky-400",
  "agent_run.failed": "text-red-400",
  "agent_run.cancelled": "text-amber-400",
  "agent_run.dead_lettered": "text-red-500",
  "alert.delivered": "text-purple-400",
  "splunk.investigation.completed": "text-cyan-400",
};

export function LiveEventStream({
  organizationId,
  className,
}: LiveEventStreamProps) {
  const { events, status } = useEventStream({
    organizationId,
    enabled: !!organizationId,
  });

  return (
    <div
      className={`bg-card border-border rounded-xl border p-6 ${className ?? ""}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Live Event Stream</h2>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              status === "open"
                ? "bg-emerald-400"
                : status === "connecting"
                  ? "bg-amber-400"
                  : status === "error"
                    ? "bg-red-400"
                    : "bg-muted"
            }`}
          />
          <span className="text-muted-foreground">
            {status === "open"
              ? "Connected"
              : status === "connecting"
                ? "Connecting"
                : status === "error"
                  ? "Reconnecting"
                  : "Idle"}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Waiting for events… (this panel updates in real time via Server-Sent
          Events)
        </p>
      ) : (
        <ul className="space-y-2">
          {events
            .slice(-10)
            .reverse()
            .map((evt) => (
              <li
                key={evt.id}
                className="border-border/60 flex items-start justify-between gap-3 border-b pb-2 text-sm"
              >
                <div className="flex-1">
                  <p
                    className={`font-mono text-xs ${
                      STATUS_COLOR[evt.eventType] ?? "text-foreground"
                    }`}
                  >
                    {evt.eventType}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(evt.createdAt).toLocaleTimeString()}
                    {evt.resourceType ? ` · ${evt.resourceType}` : ""}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
