"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";
import { AgentBudgetWidget } from "./agent-budget-widget";

interface AgentDetailContentProps {
  agentId: string;
}

const statusColors: Record<string, string> = {
  Active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  Paused: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  Disabled: "border-border bg-muted text-muted-foreground",
};

export function AgentDetailContent({ agentId }: AgentDetailContentProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: agent } = useQuery(
    trpc.agent.byId.queryOptions({ id: agentId }),
  );
  const { data: stats = [] } = useQuery(
    trpc.analytics.agentStats.queryOptions(),
  );
  const { data: versions = [] } = useQuery(
    trpc.agent.versions.queryOptions({ agentId }),
  );
  const { data: grants = [] } = useQuery(
    trpc.agent.grants.queryOptions({ agentId }),
  );
  const { data: tools = [] } = useQuery(trpc.agent.tools.queryOptions());
  const { data: runs = [] } = useQuery(
    trpc.agent.runs.queryOptions({ agentId, limit: 10 }),
  );
  const { data: sessions = [] } = useQuery(
    trpc.session.byAgent.queryOptions({ agentId }),
  );

  const enableMutation = useMutation(
    trpc.agent.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Agent updated");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const deleteMutation = useMutation(
    trpc.agent.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Agent deleted");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

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
        <Button asChild variant="outline">
          <Link href="/agents">← Back to agents</Link>
        </Button>
      </div>
    );
  }

  const stat = stats.find((s) => s.agentId === agent.id);
  const providerBadge = agent.baseUrl
    ? `${agent.modelProvider} → ${formatBaseUrl(agent.baseUrl)}`
    : `${agent.modelProvider} / ${agent.modelName}`;

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div>
        <div className="text-muted-foreground mb-2 text-sm">
          <Link href="/agents" className="hover:text-foreground">
            Agents
          </Link>{" "}
          / {agent.name}
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{agent.name}</h1>
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${
                  statusColors[agent.status] ?? statusColors.Active
                }`}
              >
                {agent.status}
              </span>
              {agent.requiresApproval && (
                <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400">
                  Requires approval
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              {agent.description ?? "No description provided."}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Type: {agent.type} · Provider: {providerBadge}
              {agent.hasApiKey ? " · API key configured" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/agents/${agent.id}/sessions`}>
                View sessions ({sessions.length})
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                enableMutation.mutate({
                  id: agent.id,
                  status: agent.status === "Active" ? "Paused" : "Active",
                })
              }
              disabled={enableMutation.isPending}
            >
              {agent.status === "Active" ? "Pause" : "Resume"}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${agent.name}"? Past sessions are kept for audit.`,
                  )
                ) {
                  deleteMutation.mutate(agent.id);
                }
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>

      {stat && (
        <section className="bg-card border-border rounded-xl border p-6">
          <h2 className="text-lg font-semibold">Scorecard</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Sessions" value={stat.totalSessions.toString()} />
            <Metric
              label="Reliability"
              value={`${stat.reliability}%`}
              tone={
                stat.reliability >= 90
                  ? "good"
                  : stat.reliability >= 70
                    ? "warn"
                    : "bad"
              }
            />
            <Metric label="Monthly Cost" value={`$${stat.totalCost.toFixed(2)}`} />
            <Metric label="Efficiency" value={`${stat.efficiency}%`} />
          </div>
        </section>
      )}

      <section className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Configuration</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={agent.name} />
          <Field label="Type" value={agent.type} />
          <Field label="Model" value={`${agent.modelProvider} / ${agent.modelName}`} />
          <Field
            label="Cost / 1k tokens"
            value={`$${agent.costPer1kTokens.toFixed(4)}`}
          />
          <Field
            label="Base URL"
            value={agent.baseUrl ?? "Built-in provider"}
            mono
          />
          <Field
            label="API key"
            value={agent.hasApiKey ? "Configured (encrypted)" : "Not set"}
          />
          <Field
            label="Tool mode"
            value={agent.toolMode}
          />
          <Field
            label="Created"
            value={new Date(agent.createdAt).toLocaleString()}
          />
        </div>
        {agent.systemPrompt && (
          <div className="mt-4">
            <p className="text-muted-foreground text-xs">System prompt</p>
            <pre className="bg-muted mt-1 max-h-48 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {agent.systemPrompt}
            </pre>
          </div>
        )}
      </section>

      <AgentBudgetWidget agentId={agent.id} />

      <section className="bg-card border-border rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Versions</h2>
          <span className="text-muted-foreground text-xs">
            {versions.length} recorded
          </span>
        </div>
        {versions.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">No versions.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th className="py-2 pr-4">Version</th>
                  <th className="py-2 pr-4">Model</th>
                  <th className="py-2 pr-4">Cost/1k</th>
                  <th className="py-2 pr-4">Change</th>
                  <th className="py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 font-medium">v{v.version}</td>
                    <td className="py-3 pr-4 text-xs">
                      {v.modelProvider}/{v.modelName}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      ${v.costPer1kTokens.toFixed(4)}
                    </td>
                    <td className="py-3 pr-4 text-xs">{v.changeSummary}</td>
                    <td className="text-muted-foreground py-3 pr-4 text-xs">
                      {new Date(v.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Tool Grants</h2>
        {grants.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            No tools granted to this agent.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {grants.map((g) => {
              const tool = tools.find((t) => t.id === g.toolId);
              return (
                <li
                  key={g.id}
                  className="border-border flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <span>
                    {tool?.displayName ?? g.toolId}
                    {tool && (
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        ({tool.name})
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Recent Runs</h2>
        {runs.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">No runs yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Input</th>
                  <th className="py-2 pr-4">Cost</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2">Run</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 font-medium">{run.status}</td>
                    <td className="max-w-xs truncate py-3 pr-4">{run.input}</td>
                    <td className="py-3 pr-4">${run.totalCost.toFixed(4)}</td>
                    <td className="py-3 pr-4 text-xs">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3">
                      <Link
                        href={`/runs/${run.id}`}
                        className="text-primary text-xs hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "bad"
          ? "text-red-400"
          : "";
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`mt-1 text-sm ${mono ? "font-mono text-xs" : "font-medium"}`}>
        {value}
      </p>
    </div>
  );
}

function formatBaseUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
