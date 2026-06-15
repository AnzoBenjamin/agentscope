"use client";

import { useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";
import { Button } from "@agentscope/ui/button";
import { toast } from "@agentscope/ui/toast";

import { EventTimeline } from "~/app/_components/dashboard/event-timeline";
import {
  ActivityIcon,
  CheckCircleIcon,
  ClockIcon,
  DollarIcon,
  HashIcon,
  ShieldCheckIcon,
} from "~/app/_components/icons";
import { InvestigationReport } from "~/app/_components/investigation-report";
import type { InvestigationReportData } from "~/app/_components/investigation-report";
import { Markdown } from "~/app/_components/markdown";
import { useTRPC } from "~/trpc/react";

export function SessionDetailContent({ sessionId }: { sessionId: string }) {
  const trpc = useTRPC();
  const { data } = useSuspenseQuery(
    trpc.session.replay.queryOptions({ sessionId }),
  );
  const [investigation, setInvestigation] =
    useState<InvestigationReportData | null>(null);
  const investigate = useMutation(
    trpc.session.investigate.mutationOptions({
      onSuccess: (result) => {
        setInvestigation(result);
        toast.success("Splunk investigation complete");
      },
      onError: (err) => {
        toast.error(err.message || "Failed to run Splunk investigation");
      },
    }),
  );

  const { session } = data;

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground text-lg">Session not found</p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    Running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    Completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Failed: "bg-red-500/10 text-red-400 border-red-500/20",
    Cancelled: "bg-muted text-muted-foreground border-border",
  };

  const duration = session.endedAt
    ? Math.round(
        (new Date(session.endedAt).getTime() -
          new Date(session.startedAt).getTime()) /
          1000,
      )
    : null;

  const tokens = (session.totalTokens ?? 0).toLocaleString();
  const cost = (session.totalCost ?? 0).toFixed(4);

  return (
    <div className="container mx-auto space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
            <ActivityIcon className="size-3.5" />
            Session Replay
          </div>
          <h1 className="mt-1.5 text-3xl font-bold tracking-tight">
            {session.input
              ? session.input.length > 80
                ? session.input.slice(0, 80) + "…"
                : session.input
              : "Untitled task"}
          </h1>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1">
              <HashIcon className="size-3" />
              <code className="font-mono">{sessionId.slice(0, 8)}</code>
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold capitalize",
                statusColors[session.status] ?? statusColors.Completed,
              )}
            >
              {session.status === "Completed" && (
                <CheckCircleIcon className="size-3" />
              )}
              {session.status}
            </span>
          </div>
        </div>
        <Button
          onClick={() => investigate.mutate({ sessionId })}
          disabled={investigate.isPending}
        >
          <ShieldCheckIcon className="size-4" />
          {investigate.isPending ? "Investigating…" : "Run Splunk Check"}
        </Button>
      </div>

      {/* Session meta — compact stat row */}
      <div className="bg-card border-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border sm:grid-cols-4">
        <StatTile
          icon={<ClockIcon className="size-4" />}
          label="Duration"
          value={duration !== null ? formatDuration(duration) : "Running…"}
        />
        <StatTile
          icon={<HashIcon className="size-4" />}
          label="Tokens"
          value={tokens}
        />
        <StatTile
          icon={<DollarIcon className="size-4" />}
          label="Cost"
          value={`$${cost}`}
        />
        <StatTile
          icon={<ActivityIcon className="size-4" />}
          label="Events"
          value={data.events.length.toLocaleString()}
        />
      </div>

      {/* Agent output */}
      {session.output && (
        <section className="bg-card border-border rounded-xl border p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Final Output
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Returned by the agent when the session completed
              </p>
            </div>
            <span className="bg-primary/10 text-primary rounded-md px-2 py-1 text-[10px] font-medium tracking-wider uppercase">
              Agent response
            </span>
          </div>
          <div className="bg-muted/30 border-border/60 max-h-[28rem] overflow-y-auto rounded-lg border p-4">
            <Markdown source={session.output} />
          </div>
        </section>
      )}

      {investigation && (
        <InvestigationReport data={investigation} />
      )}

      {/* Event Timeline */}
      <section className="bg-card border-border rounded-xl border p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Event Timeline
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {data.events.length} event
              {data.events.length === 1 ? "" : "s"} captured by the agent
              runtime
            </p>
          </div>
          <span className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-[10px] font-medium tracking-wider uppercase">
            Postgres · Splunk
          </span>
        </div>
        <EventTimeline events={data.events as TimelineEvent[]} />
      </section>
    </div>
  );
}

interface TimelineEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-card p-4">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-xl font-bold tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
