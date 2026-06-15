"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";
import { Button } from "@agentscope/ui/button";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

interface RunDetailContentProps {
  runId: string;
}

const statusColors: Record<string, string> = {
  Queued: "bg-muted text-muted-foreground border-border",
  Running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Retrying: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Failed: "bg-red-500/10 text-red-400 border-red-500/20",
  Cancelled: "bg-muted text-muted-foreground border-border",
  DeadLettered: "bg-red-500/10 text-red-500 border-red-500/30",
  AwaitingApproval: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

interface InvestigationResult {
  status: string;
  usedSplunkMcp: boolean;
  query: string;
  summary: string;
  findings: string[];
  riskLevel: string;
}

export function RunDetailContent({ runId }: RunDetailContentProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const runQuery = useQuery(
    trpc.agent.runById.queryOptions({ id: runId }),
  );
  const run = runQuery.data;
  const { data: agents = [] } = useQuery(trpc.agent.all.queryOptions());

  const cancel = useMutation(
    trpc.agent.cancelRun.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Run cancelled");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  if (runQuery.isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="bg-muted h-8 w-64 animate-pulse rounded-md" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="container mx-auto space-y-4 px-4 py-16 text-center">
        <p className="text-muted-foreground text-lg">Run not found</p>
        <Button asChild variant="outline">
          <Link href="/agents">← Back to agents</Link>
        </Button>
      </div>
    );
  }

  const agent = agents.find((a) => a.id === run.agentId);
  const canCancel =
    run.status === "Queued" ||
    run.status === "Running" ||
    run.status === "Retrying" ||
    run.status === "AwaitingApproval";
  const duration = (() => {
    if (!run.startedAt) return "Not started";
    const end = run.completedAt ?? new Date();
    const ms = end.getTime() - new Date(run.startedAt).getTime();
    return `${(ms / 1000).toFixed(1)}s`;
  })();
  const investigationData = parseInvestigation(run.investigation);

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div>
        <div className="text-muted-foreground mb-2 text-sm">
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>{" "}
          /{" "}
          {agent ? (
            <Link
              href={`/agents/${agent.id}`}
              className="hover:text-foreground"
            >
              {agent.name}
            </Link>
          ) : (
            "Unknown"
          )}{" "}
          / Run
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">Run Detail</h1>
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
                  statusColors[run.status] ?? statusColors.Queued,
                )}
              >
                {run.status}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {run.attempts}/{run.maxAttempts} attempts · {duration}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {run.sessionId && (
              <Button asChild variant="outline">
                <Link href={`/sessions/${run.sessionId}`}>
                  Open session replay
                </Link>
              </Button>
            )}
            {canCancel && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={cancel.isPending}
                onClick={() => {
                  if (window.confirm("Cancel this run?")) {
                    cancel.mutate({ id: run.id });
                  }
                }}
              >
                {cancel.isPending ? "Cancelling..." : "Cancel run"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <section className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Run metadata</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Created" value={new Date(run.createdAt).toLocaleString()} />
          {run.startedAt && (
            <Field
              label="Started"
              value={new Date(run.startedAt).toLocaleString()}
            />
          )}
          {run.completedAt && (
            <Field
              label="Completed"
              value={new Date(run.completedAt).toLocaleString()}
            />
          )}
          {run.cancelledAt && (
            <Field
              label="Cancelled"
              value={new Date(run.cancelledAt).toLocaleString()}
            />
          )}
          {run.deadLetteredAt && (
            <Field
              label="Dead-lettered"
              value={new Date(run.deadLetteredAt).toLocaleString()}
            />
          )}
          <Field
            label="Run after"
            value={new Date(run.runAfter).toLocaleString()}
          />
          {run.lockedAt && (
            <Field
              label="Locked"
              value={`${new Date(run.lockedAt).toLocaleString()}${run.lockedBy ? ` (${run.lockedBy})` : ""}`}
            />
          )}
          <Field label="Total tokens" value={run.totalTokens.toLocaleString()} />
          <Field label="Total cost" value={`$${run.totalCost.toFixed(4)}`} />
          <Field label="Tool calls" value={String(run.toolCalls)} />
        </div>
      </section>

      <section className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Input</h2>
        <pre className="bg-muted mt-3 overflow-x-auto rounded-md p-4 text-sm whitespace-pre-wrap">
          {run.input}
        </pre>
      </section>

      {run.output && (
        <section className="bg-card border-border rounded-xl border p-6">
          <h2 className="text-lg font-semibold">Output</h2>
          <pre className="bg-muted mt-3 max-h-96 overflow-auto rounded-md p-4 text-sm whitespace-pre-wrap">
            {run.output}
          </pre>
        </section>
      )}

      {run.error && (
        <section className="bg-card border-border rounded-xl border border-red-500/20 p-6">
          <h2 className="text-lg font-semibold text-red-400">Error</h2>
          <pre className="bg-muted mt-3 overflow-x-auto rounded-md p-4 text-sm whitespace-pre-wrap text-red-400">
            {run.error}
          </pre>
        </section>
      )}

      {investigationData && (
        <section className="bg-card border-border rounded-xl border p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Splunk Investigation</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Stored on the run from a prior Splunk MCP query.
              </p>
            </div>
            <span
              className={cn(
                "inline-flex w-fit rounded-md border px-2.5 py-1 text-xs font-semibold capitalize",
                investigationData.riskLevel === "high"
                  ? "border-red-500/20 bg-red-500/10 text-red-400"
                  : investigationData.riskLevel === "medium"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
                    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
              )}
            >
              {investigationData.riskLevel} risk
            </span>
          </div>
          <p className="mt-4 text-sm leading-6">{investigationData.summary}</p>
          {investigationData.findings.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {investigationData.findings.map((finding) => (
                <li key={finding}>- {finding}</li>
              ))}
            </ul>
          )}
          {investigationData.query && (
            <div className="bg-muted mt-4 overflow-x-auto rounded-md p-3">
              <code className="text-xs">{investigationData.query}</code>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function parseInvestigation(value: unknown): InvestigationResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const findings = Array.isArray(record.findings)
    ? record.findings.filter(
        (f): f is string => typeof f === "string",
      )
    : [];
  return {
    status: typeof record.status === "string" ? record.status : "",
    usedSplunkMcp: record.usedSplunkMcp === true,
    query: typeof record.query === "string" ? record.query : "",
    summary: typeof record.summary === "string" ? record.summary : "",
    findings,
    riskLevel:
      typeof record.riskLevel === "string" ? record.riskLevel : "unknown",
  };
}
