"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";

import { useTRPC } from "~/trpc/react";

const runStatusStyles: Record<string, string> = {
  Queued: "bg-muted text-muted-foreground border-border",
  Running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Passed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Failed: "bg-red-500/10 text-red-400 border-red-500/20",
  Errored: "bg-red-500/10 text-red-500 border-red-500/30",
};

/**
 * Evaluation results viewer. Each evaluation tracks multiple runs
 * (one per "Run" click). We surface the latest run inline and let the
 * user expand the row to see the full history.
 */
export function EvaluationsContent() {
  const trpc = useTRPC();
  const { data: evaluations = [] } = useQuery(
    trpc.agent.evaluations.queryOptions(),
  );
  const { data: allRuns = [] } = useQuery(
    trpc.agent.evaluationRuns.queryOptions(),
  );
  const { data: agents = [] } = useQuery(trpc.agent.all.queryOptions());

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Group runs by evaluationId so we can show the latest result inline.
  const runsByEvaluation = useMemo(() => {
    const grouped = new Map<string, typeof allRuns>();
    for (const run of allRuns) {
      const list = grouped.get(run.evaluationId) ?? [];
      list.push(run);
      grouped.set(run.evaluationId, list);
    }
    for (const list of grouped.values()) {
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }
    return grouped;
  }, [allRuns]);

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Evaluations</h1>
        <p className="text-muted-foreground mt-1">
          Test runs that score agents on expected signals.
        </p>
      </div>

      <div className="bg-card border-border overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="bg-muted/50 border-border border-b">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Threshold</th>
                <th className="px-4 py-3 font-medium">Latest run</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {evaluations.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="text-muted-foreground px-4 py-8 text-center"
                  >
                    No evaluations yet. Create one from the{" "}
                    <Link
                      href="/agents"
                      className="text-primary hover:underline"
                    >
                      Agents page
                    </Link>{" "}
                    to start scoring agent behavior.
                  </td>
                </tr>
              ) : (
                evaluations.map((evaluation) => {
                  const evalAgent = agents.find(
                    (a) => a.id === evaluation.agentId,
                  );
                  const runs = runsByEvaluation.get(evaluation.id) ?? [];
                  const latest = runs[0];
                  const expanded = expandedId === evaluation.id;
                  return (
                    <EvalRow
                      key={evaluation.id}
                      evaluation={evaluation}
                      agentName={evalAgent?.name ?? "Unknown"}
                      agentId={evalAgent?.id}
                      latest={latest}
                      runs={runs}
                      expanded={expanded}
                      onToggle={() =>
                        setExpandedId(expanded ? null : evaluation.id)
                      }
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EvalRow({
  evaluation,
  agentName,
  agentId,
  latest,
  runs,
  expanded,
  onToggle,
}: {
  evaluation: {
    id: string;
    name: string;
    passThreshold: number;
    createdAt: Date | string;
  };
  agentName: string;
  agentId?: string;
  latest:
    | {
        id: string;
        status: string;
        agentRunId: string | null;
        createdAt: Date | string;
      }
    | undefined;
  runs: {
    id: string;
    status: string;
    agentRunId: string | null;
    createdAt: Date | string;
  }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3 font-medium">{evaluation.name}</td>
        <td className="px-4 py-3">
          {agentId ? (
            <Link
              href={`/agents/${agentId}`}
              className="text-primary hover:underline"
            >
              {agentName}
            </Link>
          ) : (
            agentName
          )}
        </td>
        <td className="text-muted-foreground px-4 py-3 tabular-nums">
          {(evaluation.passThreshold * 100).toFixed(0)}%
        </td>
        <td className="px-4 py-3">
          {latest ? (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
                runStatusStyles[latest.status] ?? runStatusStyles.Queued,
              )}
            >
              {latest.status}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">Never run</span>
          )}
        </td>
        <td className="text-muted-foreground px-4 py-3 text-xs">
          {latest
            ? new Date(latest.createdAt).toLocaleDateString()
            : "—"}
        </td>
        <td className="text-muted-foreground px-4 py-3 text-xs">
          {new Date(evaluation.createdAt).toLocaleDateString()}
        </td>
        <td className="px-4 py-3">
          <Button variant="ghost" onClick={onToggle}>
            {expanded
              ? "Hide history"
              : runs.length > 0
                ? `History (${runs.length})`
                : "View"}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/30">
          <td colSpan={7} className="px-4 py-3">
            {runs.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No runs yet. Use the &quot;Run&quot; button on the Agents
                page to start an evaluation.
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                          runStatusStyles[run.status] ?? runStatusStyles.Queued,
                        )}
                      >
                        {run.status}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                    </span>
                    <Link
                      href={run.agentRunId ? `/runs/${run.agentRunId}` : "#"}
                      className="text-primary text-xs hover:underline"
                      aria-disabled={!run.agentRunId}
                    >
                      Open run →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Button({
  variant,
  onClick,
  children,
}: {
  variant: "ghost" | "outline" | "default";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        variant === "ghost" && "hover:bg-muted",
        variant === "outline" && "border-border border hover:bg-muted",
        variant === "default" &&
          "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {children}
    </button>
  );
}
