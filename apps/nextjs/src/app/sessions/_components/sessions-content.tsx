"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";

import { useTRPC } from "~/trpc/react";

const statusStyles: Record<string, string> = {
  Running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Failed: "bg-red-500/10 text-red-400 border-red-500/20",
  Cancelled: "bg-muted text-muted-foreground border-border",
};

const statusIcons: Record<string, string> = {
  Running: "RUN",
  Completed: "OK",
  Failed: "ERR",
  Cancelled: "OFF",
};

export function SessionsContent() {
  const trpc = useTRPC();
  const { data: sessions } = useSuspenseQuery(trpc.session.all.queryOptions());
  const { data: agents = [] } = useQuery(trpc.agent.all.queryOptions());
  const [agentFilter, setAgentFilter] = useState("");

  const filteredSessions = agentFilter
    ? sessions.filter((s) => s.agentId === agentFilter)
    : sessions;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of filteredSessions) {
      counts[s.status] = (counts[s.status] ?? 0) + 1;
    }
    return counts;
  }, [filteredSessions]);

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
          <p className="text-muted-foreground mt-1">
            Track every agent task execution - {filteredSessions.length}{" "}
            session{filteredSessions.length === 1 ? "" : "s"} recorded
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filter by agent:</span>
          <select
            value={agentFilter}
            onChange={(event) => setAgentFilter(event.target.value)}
            className="bg-background border-border h-10 rounded-md border px-3 text-sm"
          >
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Status summary pills */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(statusCounts).map(([status, count]) => (
          <span
            key={status}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              statusStyles[status] ?? statusStyles.Completed,
            )}
          >
            <span>{statusIcons[status] ?? "OK"}</span>
            {status}: {count}
          </span>
        ))}
      </div>

      {/* Sessions table */}
      {filteredSessions.length === 0 ? (
        <div className="text-muted-foreground py-16 text-center">
          <p className="text-lg">No sessions recorded</p>
          <p className="mt-1 text-sm">
            Run an agent to start recording session data
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
                {filteredSessions.map((session) => (
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
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        Agent:{" "}
                        {(() => {
                          const agent = agents.find(
                            (a) => a.id === session.agentId,
                          );
                          if (!agent) return session.agentId.slice(0, 8);
                          return (
                            <Link
                              href={`/agents/${agent.id}`}
                              className="hover:text-foreground hover:underline"
                            >
                              {agent.name}
                            </Link>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold",
                          statusStyles[session.status] ??
                            statusStyles.Completed,
                        )}
                      >
                        {statusIcons[session.status] ?? "OK"} {session.status}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      {(session.totalTokens ?? 0).toLocaleString()}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      ${(session.totalCost ?? 0).toFixed(4)}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {new Date(session.createdAt).toLocaleDateString()}
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
