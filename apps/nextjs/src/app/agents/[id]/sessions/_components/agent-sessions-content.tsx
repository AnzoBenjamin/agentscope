"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";

import { useTRPC } from "~/trpc/react";

const statusStyles: Record<string, string> = {
  Running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Failed: "bg-red-500/10 text-red-400 border-red-500/20",
  Cancelled: "bg-muted text-muted-foreground border-border",
};

interface AgentSessionsContentProps {
  agentId: string;
}

export function AgentSessionsContent({ agentId }: AgentSessionsContentProps) {
  const trpc = useTRPC();
  const { data: agent } = useQuery(
    trpc.agent.byId.queryOptions({ id: agentId }),
  );
  const { data: sessions = [] } = useQuery(
    trpc.session.byAgent.queryOptions({ agentId }),
  );

  const totals = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    let toolCalls = 0;
    for (const s of sessions) {
      tokens += s.totalTokens ?? 0;
      cost += s.totalCost ?? 0;
      toolCalls += s.toolCalls ?? 0;
    }
    return { tokens, cost, toolCalls };
  }, [sessions]);

  if (agent === undefined) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="bg-muted h-8 w-64 animate-pulse rounded-md" />
      </div>
    );
  }

  if (agent === null) {
    return (
      <div className="container mx-auto space-y-4 px-4 py-16 text-center">
        <p className="text-muted-foreground text-lg">Agent not found</p>
        <Link href="/agents" className="text-primary text-sm hover:underline">
          ← Back to agents
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div>
        <div className="text-muted-foreground mb-2 text-sm">
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>{" "}
          /{" "}
          <Link
            href={`/agents/${agent.id}`}
            className="hover:text-foreground"
          >
            {agent.name}
          </Link>{" "}
          / Sessions
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {agent.name} - Sessions
        </h1>
        <p className="text-muted-foreground mt-1">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} ·{" "}
          {totals.tokens.toLocaleString()} tokens · ${totals.cost.toFixed(4)}{" "}
          spent
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="bg-card border-border rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">Total Tokens</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {totals.tokens.toLocaleString()}
          </p>
        </div>
        <div className="bg-card border-border rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">Total Cost</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            ${totals.cost.toFixed(4)}
          </p>
        </div>
        <div className="bg-card border-border rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">Tool Calls</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {totals.toolCalls}
          </p>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="text-muted-foreground py-16 text-center">
          <p className="text-lg">No sessions recorded for this agent</p>
          <p className="mt-1 text-sm">
            Queue a run from the agents page to see sessions here.
          </p>
        </div>
      ) : (
        <div className="bg-card border-border overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-border border-b">
                  <th className="px-4 py-3 text-left font-medium">Task</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Tokens</th>
                  <th className="px-4 py-3 text-left font-medium">Cost</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {sessions.map((session) => (
                  <tr
                    key={session.id}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/sessions/${session.id}`}
                        className="text-primary font-medium hover:underline"
                      >
                        {session.input
                          ? session.input.length > 60
                            ? session.input.slice(0, 60) + "..."
                            : session.input
                          : "Untitled task"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
                          statusStyles[session.status] ?? statusStyles.Completed,
                        )}
                      >
                        {session.status}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      {(session.totalTokens ?? 0).toLocaleString()}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      ${(session.totalCost ?? 0).toFixed(4)}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
