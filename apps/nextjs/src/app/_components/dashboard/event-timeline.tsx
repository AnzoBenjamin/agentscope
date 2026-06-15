"use client";

import { useMemo, useState } from "react";

import { cn } from "@agentscope/ui";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  eventToneStyles,
  getEventMeta,
} from "~/app/_components/icons";

interface TimelineEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [events],
  );

  if (events.length === 0) {
    return (
      <div className="text-muted-foreground py-16 text-center text-sm">
        <p className="font-medium">No events recorded for this session.</p>
        <p className="mt-1 text-xs">
          Events appear here as the agent progresses.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-0">
      {sortedEvents.map((event, idx) => {
        const previousEvent = idx > 0 ? sortedEvents[idx - 1] : undefined;
        return (
          <EventRow
            key={event.id}
            event={event}
            isFirst={idx === 0}
            isLast={idx === sortedEvents.length - 1}
            previousTimestamp={
              previousEvent ? new Date(previousEvent.createdAt) : null
            }
          />
        );
      })}
    </ol>
  );
}

function EventRow({
  event,
  isFirst,
  isLast,
  previousTimestamp,
}: {
  event: TimelineEvent;
  isFirst: boolean;
  isLast: boolean;
  previousTimestamp: Date | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = getEventMeta(event.eventType);
  const tone = eventToneStyles[meta.tone];
  const Icon = meta.Icon;
  const ts = new Date(event.createdAt);
  const delta = previousTimestamp
    ? Math.max(
        0,
        Math.round((ts.getTime() - previousTimestamp.getTime()) / 100) / 10,
      )
    : null;
  const hasPayload = Object.keys(event.payload).length > 0;

  return (
    <li className="group relative flex gap-4 pb-4">
      {/* Timeline rail */}
      <div className="relative flex flex-col items-center pt-1.5">
        {!isFirst && (
          <div className="bg-border/60 absolute top-0 h-3 w-px" />
        )}
        <div
          className={cn(
            "ring-background relative z-10 flex size-7 items-center justify-center rounded-full ring-2",
            tone.chip,
          )}
        >
          <Icon className={cn("size-3.5", tone.chipText)} />
        </div>
        {!isLast && (
          <div className="bg-border/60 absolute top-7.5 bottom-0 w-px" />
        )}
      </div>

      {/* Event card */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold",
              tone.chip,
              tone.chipText,
            )}
          >
            {meta.label}
          </span>
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs tabular-nums">
            <ClockIcon className="size-3" />
            {ts.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          {delta !== null && (
            <span className="text-muted-foreground/70 text-xs tabular-nums">
              +{delta < 1 ? "<1s" : `${delta}s`}
            </span>
          )}
        </div>

        <EventPayloadSummary payload={event.payload} />

        {hasPayload && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="text-muted-foreground hover:text-foreground mt-1.5 inline-flex items-center gap-1 text-xs font-medium transition-colors"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            {expanded ? "Hide details" : "Show details"}
          </button>
        )}

        {expanded && hasPayload && (
          <pre className="bg-muted/60 border-border/60 mt-2 max-h-80 overflow-x-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed">
            <code>{JSON.stringify(event.payload, null, 2)}</code>
          </pre>
        )}
      </div>
    </li>
  );
}

function EventPayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload);
  if (entries.length === 0) return null;

  // Pick a couple of interesting fields to surface as chips. Skip
  // large blobs (the user can expand for full JSON).
  const interesting: [string, string][] = [];
  for (const [key, value] of entries) {
    if (interesting.length >= 3) break;
    if (value == null) continue;
    if (typeof value === "string") {
      if (value.length > 80) continue;
      interesting.push([key, value]);
    } else if (typeof value === "number" || typeof value === "boolean") {
      interesting.push([key, String(value)]);
    }
  }

  if (interesting.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      {interesting.map(([key, value]) => (
        <span
          key={key}
          className="bg-muted/60 text-foreground/80 inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5"
        >
          <span className="text-muted-foreground font-medium">{key}:</span>
          <span className="truncate">{value}</span>
        </span>
      ))}
    </div>
  );
}
