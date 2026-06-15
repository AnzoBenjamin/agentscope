"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { cn } from "@agentscope/ui";
import { Input } from "@agentscope/ui/input";
import { toast } from "@agentscope/ui/toast";

import { AgentCard } from "~/app/_components/dashboard/agent-card";
import { InvestigationReport } from "~/app/_components/investigation-report";
import type { InvestigationReportData } from "~/app/_components/investigation-report";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  LightbulbIcon,
  RiskBadge,
  SparklesIcon,
} from "~/app/_components/icons";
import { useTRPC } from "~/trpc/react";
import { AgentFormModal } from "./agent-form-modal";

export function AgentsContent() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: agents } = useSuspenseQuery(trpc.agent.all.queryOptions());
  const { data: agentStats } = useSuspenseQuery(
    trpc.analytics.agentStats.queryOptions(),
  );
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [task, setTask] = useState(
    "Investigate the latest AI agent reliability, cost, and tool-use signals.",
  );
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<typeof agents[number] | null>(
    null,
  );
  const [detailsAgent, setDetailsAgent] = useState<
    (typeof agents)[number] | null
  >(null);
  const { data: runs = [] } = useQuery({
    ...trpc.agent.runs.queryOptions({ limit: 10 }),
    refetchInterval: 3000,
  });

  const getStats = (agentId: string) =>
    agentStats.find((s) => s.agentId === agentId);
  const activeAgentId =
    selectedAgentId !== "" ? selectedAgentId : (agents[0]?.id ?? "");
  const lastRun = runs.find((run) => run.id === lastRunId) ?? runs[0];
  const investigation = getInvestigation(lastRun?.investigation);

  const runAgent = useMutation(
    trpc.agent.enqueueRun.mutationOptions({
      onSuccess: async (result) => {
        setLastRunId(result.id);
        await Promise.all([
          queryClient.invalidateQueries(trpc.analytics.pathFilter()),
          queryClient.invalidateQueries(trpc.session.pathFilter()),
          queryClient.invalidateQueries(trpc.agent.pathFilter()),
        ]);
        toast.success("Agent run queued");
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }),
  );

  // Approval flow: when an agent is configured with `requiresApproval`,
  // enqueueRun parks the run in `AwaitingApproval` and creates an
  // `agent_run_approval` row. run-queue skips that status, so nothing
  // executes until a Manager+ decides. Surface that queue here.
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // Fetch the run context for each pending approval. The generic `runs`
  // query has a 10-row cap and a mixed status filter, so we use a
  // dedicated, higher-limit query to avoid missing lookups.
  const { data: awaitingRuns = [] } = useQuery({
    ...trpc.agent.runs.queryOptions({
      status: "AwaitingApproval",
      limit: 100,
    }),
    refetchInterval: 3000,
  });
  const { data: pendingApprovals = [] } = useQuery({
    ...trpc.agent.pendingApprovals.queryOptions(),
    refetchInterval: 3000,
  });

  const approveRunInternal = useMutation(
    trpc.agent.approveRun.mutationOptions({
      onSuccess: async () => {
        setApprovingId(null);
        await Promise.all([
          queryClient.invalidateQueries(trpc.agent.pathFilter()),
          queryClient.invalidateQueries(trpc.analytics.pathFilter()),
          queryClient.invalidateQueries(trpc.session.pathFilter()),
        ]);
        toast.success("Run approved and queued for execution.");
      },
      onError: (err) => {
        setApprovingId(null);
        toast.error(err.message);
      },
    }),
  );

  const rejectRunInternal = useMutation(
    trpc.agent.rejectRun.mutationOptions({
      onSuccess: async () => {
        setRejectingId(null);
        setRejectNote("");
        await Promise.all([
          queryClient.invalidateQueries(trpc.agent.pathFilter()),
          queryClient.invalidateQueries(trpc.analytics.pathFilter()),
          queryClient.invalidateQueries(trpc.session.pathFilter()),
        ]);
        toast.success("Run rejected.");
      },
      onError: (err) => {
        setRejectingId(null);
        setRejectNote("");
        toast.error(err.message);
      },
    }),
  );
  const anyApprovalBusy =
    approveRunInternal.isPending || rejectRunInternal.isPending;

  const deleteAgent = useMutation(
    trpc.agent.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Agent deleted.");
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }),
  );

  // Cancel a queued/running/retrying run. The server only allows this for
  // runs the caller requested (or for Manager+); the UI doesn't need to
  // gate it further because the API will throw if disallowed.
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const cancelRun = useMutation(
    trpc.agent.cancelRun.mutationOptions({
      onSuccess: async () => {
        setCancellingRunId(null);
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Run cancelled.");
      },
      onError: (err) => {
        setCancellingRunId(null);
        toast.error(err.message);
      },
    }),
  );

  // Tool definitions and evaluations are global to the org, not per-agent,
  // so we fetch them once at the top level and manage them with inline
  // forms below the agent grid. Versions and grants are per-agent, so we
  // gate their queries on `detailsAgent` being set.
  const { data: tools = [] } = useQuery(trpc.agent.tools.queryOptions());
  const { data: evaluations = [] } = useQuery(
    trpc.agent.evaluations.queryOptions(),
  );
  const { data: grantsForAgent = [] } = useQuery({
    ...trpc.agent.grants.queryOptions({ agentId: detailsAgent?.id ?? "" }),
    enabled: detailsAgent !== null,
  });
  const { data: versionsForAgent = [] } = useQuery({
    ...trpc.agent.versions.queryOptions({ agentId: detailsAgent?.id ?? "" }),
    enabled: detailsAgent !== null,
  });

  const [toolForm, setToolForm] = useState({
    name: "",
    displayName: "",
    description: "",
  });
  const [evalForm, setEvalForm] = useState({
    agentId: "",
    name: "",
    prompt: "",
    signals: "",
    threshold: "0.8",
  });
  const [grantToolId, setGrantToolId] = useState("");

  const createTool = useMutation(
    trpc.agent.createTool.mutationOptions({
      onSuccess: async () => {
        setToolForm({ name: "", displayName: "", description: "" });
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Tool created");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const grantTool = useMutation(
    trpc.agent.grantTool.mutationOptions({
      onSuccess: async () => {
        setGrantToolId("");
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Tool granted");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const revokeTool = useMutation(
    trpc.agent.revokeTool.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Tool revoked");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const createEvaluation = useMutation(
    trpc.agent.createEvaluation.mutationOptions({
      onSuccess: async () => {
        setEvalForm({
          agentId: "",
          name: "",
          prompt: "",
          signals: "",
          threshold: "0.8",
        });
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Evaluation created");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const runEvaluation = useMutation(
    trpc.agent.runEvaluation.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Evaluation queued");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const handleSaved = async () => {
    await queryClient.invalidateQueries(trpc.agent.pathFilter());
  };

  const openCreate = () => {
    setEditingAgent(null);
    setFormOpen(true);
  };

  const openEdit = (agent: typeof agents[number]) => {
    setEditingAgent(agent);
    setFormOpen(true);
  };

  const handleDelete = (agent: typeof agents[number]) => {
    const confirmed = window.confirm(
      `Delete "${agent.name}"? This removes the agent and stops any further runs. Past sessions are kept for audit.`,
    );
    if (!confirmed) return;
    deleteAgent.mutate(agent.id);
  };

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
          <p className="text-muted-foreground mt-1">
            Manage your AI employees: deploy, monitor, and optimize
          </p>
        </div>
        <Button onClick={openCreate}>+ New agent</Button>
      </div>

      {agents.length > 0 && (
        <section className="bg-card border-border rounded-xl border p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-lg font-semibold">
                Run Splunk Investigation
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Execute an AI employee, write replay events to Postgres and
                Splunk HEC, then query the session through Splunk MCP.
              </p>
            </div>
            <form
              className="flex w-full flex-col gap-3 lg:max-w-xl"
              onSubmit={(event) => {
                event.preventDefault();
                if (!activeAgentId || !task.trim()) return;
                runAgent.mutate({
                  agentId: activeAgentId,
                  input: task.trim(),
                });
              }}
            >
              <select
                value={activeAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
                className="bg-background border-border h-10 rounded-md border px-3 text-sm"
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} - {agent.modelProvider}/{agent.modelName}
                  </option>
                ))}
              </select>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                  aria-label="Agent task"
                />
                <Button
                  type="submit"
                  disabled={
                    !activeAgentId || !task.trim() || runAgent.isPending
                  }
                  className="shrink-0"
                >
                  {runAgent.isPending ? "Queueing..." : "Queue Run"}
                </Button>
              </div>
            </form>
          </div>

          {lastRun && (
            <div className="border-border mt-6 space-y-5 border-t pt-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <RunStat
                  label="Run Status"
                  icon={
                    lastRun.status === "Completed" ? (
                      <CheckCircleIcon className="text-emerald-500" />
                    ) : lastRun.status === "Failed" ||
                      lastRun.status === "Cancelled" ? (
                      <AlertCircleIcon className="text-red-500" />
                    ) : (
                      <ClockIcon className="text-blue-500" />
                    )
                  }
                  value={lastRun.status}
                  capitalize
                />
                <RunStat
                  label="Session"
                  icon={<SparklesIcon className="text-violet-500" />}
                  value={
                    lastRun.sessionId ? (
                      <Link
                        href={`/sessions/${lastRun.sessionId}`}
                        className="text-primary hover:underline"
                      >
                        Open replay
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Pending</span>
                    )
                  }
                />
                <RunStat
                  label="Risk"
                  icon={<LightbulbIcon className="text-amber-500" />}
                  value={
                    investigation ? (
                      <RiskBadge level={investigation.riskLevel} />
                    ) : (
                      <span className="text-muted-foreground">Pending</span>
                    )
                  }
                />
                <RunStat
                  label="Cost"
                  icon={
                    <span className="text-base font-bold text-emerald-500">
                      $
                    </span>
                  }
                  value={
                    <span className="flex flex-col">
                      <span className="text-foreground text-sm font-semibold tabular-nums">
                        ${lastRun.totalCost.toFixed(4)}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {lastRun.totalTokens.toLocaleString()} tokens
                      </span>
                    </span>
                  }
                />
              </div>

              <InvestigationReport
                data={
                  investigation ?? {
                    status: lastRun.status,
                    usedSplunkMcp: false,
                    query: "",
                    summary:
                      lastRun.error ??
                      "Waiting for the worker to execute the queued run. The Splunk MCP investigator will produce a summary here once the session completes.",
                    findings: [
                      `Attempts: ${lastRun.attempts}/${lastRun.maxAttempts}`,
                      `Requested: ${new Date(lastRun.createdAt).toLocaleString()}`,
                    ],
                    riskLevel: "low",
                  }
                }
              />
            </div>
          )}
      </section>
    )}

    {pendingApprovals.length > 0 && (
      <section className="bg-card border-border rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Pending Approvals</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Runs for agents that require human approval before they
              execute.
            </p>
          </div>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            {pendingApprovals.length} awaiting
          </span>
        </div>
        <div className="mt-5 space-y-3">
          {pendingApprovals.map((approval) => {
            const run = awaitingRuns.find(
              (r) => r.id === approval.agentRunId,
            );
            const agent = run
              ? agents.find((a) => a.id === run.agentId)
              : null;
            const isApproving =
              approveRunInternal.isPending && approvingId === approval.id;
            const isRejecting =
              rejectRunInternal.isPending && rejectingId === approval.id;
            const rejectPanelOpen = rejectingId === approval.id;
            return (
              <div
                key={approval.id}
                className="border-border/60 bg-muted/30 rounded-lg border p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                        {agent?.name ?? "Unknown agent"}
                      </span>
                      {agent && (
                        <span className="text-muted-foreground text-xs">
                          {agent.modelProvider}
                          {agent.baseUrl
                            ? ` → ${formatBaseUrl(agent.baseUrl)}`
                            : ` / ${agent.modelName}`}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                      {run?.input ?? "(run context unavailable)"}
                    </p>
                    <p className="text-muted-foreground mt-2 text-xs">
                      Requested{" "}
                      {new Date(approval.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={anyApprovalBusy}
                      onClick={() => {
                        setApprovingId(approval.id);
                        approveRunInternal.mutate({ approvalId: approval.id });
                      }}
                    >
                      {isApproving ? "Approving..." : "Approve"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={anyApprovalBusy}
                      onClick={() => {
                        if (rejectPanelOpen) {
                          setRejectingId(null);
                          setRejectNote("");
                        } else {
                          setRejectingId(approval.id);
                          setRejectNote("");
                        }
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      {rejectPanelOpen && !isRejecting ? "Cancel" : "Reject"}
                    </Button>
                  </div>
                </div>
                {rejectPanelOpen && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Optional note explaining the rejection..."
                      rows={2}
                      maxLength={1000}
                      className="bg-background border-border w-full rounded-md border p-2 text-sm"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectNote("");
                        }}
                        disabled={rejectRunInternal.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          rejectRunInternal.mutate({
                            approvalId: approval.id,
                            note: rejectNote.trim() || undefined,
                          });
                        }}
                        disabled={rejectRunInternal.isPending}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isRejecting ? "Rejecting..." : "Confirm reject"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    )}

    {runs.length > 0 && (
      <section className="bg-card border-border rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent Runs</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Queued work is executed by the AgentScope worker and retried on
                transient Splunk or model failures.
              </p>
            </div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Input</th>
                  <th className="py-2 pr-4 font-medium">Attempts</th>
                  <th className="py-2 pr-4 font-medium">Cost</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 font-medium">Replay</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 font-medium">{run.status}</td>
                    <td className="max-w-sm truncate py-3 pr-4">{run.input}</td>
                    <td className="py-3 pr-4">
                      {run.attempts}/{run.maxAttempts}
                    </td>
                    <td className="py-3 pr-4">${run.totalCost.toFixed(4)}</td>
                    <td className="py-3 pr-4">
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3">
                      {run.sessionId ? (
                        <Link
                          href={`/sessions/${run.sessionId}`}
                          className="text-primary hover:underline"
                        >
                          Open
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </td>
                    <td className="py-3">
                      {run.status === "Queued" ||
                      run.status === "Running" ||
                      run.status === "Retrying" ||
                      run.status === "AwaitingApproval" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={
                            cancelRun.isPending &&
                            cancellingRunId === run.id
                          }
                          onClick={() => {
                            setCancellingRunId(run.id);
                            cancelRun.mutate({ id: run.id });
                          }}
                        >
                          {cancelRun.isPending && cancellingRunId === run.id
                            ? "Cancelling..."
                            : "Cancel"}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => {
          const stats = getStats(agent.id);
          const providerBadge =
            agent.baseUrl !== null
              ? `${agent.modelProvider} \u2192 ${formatBaseUrl(agent.baseUrl)}`
              : `${agent.modelProvider} / ${agent.modelName}`;
          return (
            <div
              key={agent.id}
              className="bg-card border-border relative rounded-xl border shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
            >
              <AgentCard
                name={agent.name}
                description={agent.description ?? ""}
                modelProvider={providerBadge}
                modelName={agent.modelName}
                status={agent.status}
                sessionCount={stats?.totalSessions}
                reliability={stats?.reliability}
              />
              <div className="border-border/60 flex items-center justify-between gap-2 border-t px-6 py-3">
                <div className="text-muted-foreground text-xs">
                  {agent.baseUrl ? (
                    <span title={agent.baseUrl}>
                      Custom endpoint
                      {agent.hasApiKey ? " \u00b7 key configured" : ""}
                    </span>
                  ) : (
                    <span>{agent.modelName}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/agents/${agent.id}`}>
                      Open
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDetailsAgent(agent)}
                    aria-label={`Details for ${agent.name}`}
                  >
                    Details
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(agent)}
                    aria-label={`Edit ${agent.name}`}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(agent)}
                    disabled={deleteAgent.isPending}
                    aria-label={`Delete ${agent.name}`}
                    className="text-destructive hover:text-destructive"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {agents.length === 0 && (
        <div className="text-muted-foreground py-16 text-center">
          <p className="text-lg">No agents deployed yet</p>
          <p className="mt-1 text-sm">
            Create your first AI employee to get started
          </p>
        </div>
      )}

      <section className="bg-card border-border rounded-xl border p-6">
        <div>
          <h2 className="text-lg font-semibold">Tool Definitions</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Custom tools your agents can call. Grant them to specific agents
            from the agent card's "Details" panel.
          </p>
        </div>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            createTool.mutate({
              name: toolForm.name.trim(),
              displayName: toolForm.displayName.trim(),
              description: toolForm.description.trim() || undefined,
            });
          }}
        >
          <Input
            value={toolForm.name}
            onChange={(event) =>
              setToolForm({ ...toolForm, name: event.target.value })
            }
            placeholder="tool_name (snake_case)"
            minLength={2}
            maxLength={128}
            required
          />
          <Input
            value={toolForm.displayName}
            onChange={(event) =>
              setToolForm({ ...toolForm, displayName: event.target.value })
            }
            placeholder="Display Name"
            minLength={2}
            maxLength={256}
            required
          />
          <Input
            value={toolForm.description}
            onChange={(event) =>
              setToolForm({ ...toolForm, description: event.target.value })
            }
            placeholder="Description (optional)"
            maxLength={2000}
          />
          <Button type="submit" disabled={createTool.isPending}>
            {createTool.isPending ? "Creating..." : "+ Tool"}
          </Button>
        </form>
        {tools.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Display</th>
                  <th className="py-2 pr-4">Scope</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 font-mono text-xs">{t.name}</td>
                    <td className="py-3 pr-4">{t.displayName}</td>
                    <td className="py-3 pr-4">{t.scope}</td>
                    <td className="py-3">
                      {t.enabled ? "Enabled" : "Disabled"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-card border-border rounded-xl border p-6">
        <div>
          <h2 className="text-lg font-semibold">Evaluations</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Test runs that score agents on expected signals.
          </p>
        </div>
        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            createEvaluation.mutate({
              agentId: evalForm.agentId,
              name: evalForm.name.trim(),
              prompt: evalForm.prompt,
              expectedSignals: evalForm.signals
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              passThreshold: Number.parseFloat(evalForm.threshold) || 0.8,
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={evalForm.agentId}
              onChange={(event) =>
                setEvalForm({ ...evalForm, agentId: event.target.value })
              }
              required
              className="bg-background border-border h-10 rounded-md border px-3 text-sm"
            >
              <option value="">Select agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <Input
              value={evalForm.name}
              onChange={(event) =>
                setEvalForm({ ...evalForm, name: event.target.value })
              }
              placeholder="Eval name"
              minLength={2}
              maxLength={256}
              required
            />
          </div>
          <textarea
            value={evalForm.prompt}
            onChange={(event) =>
              setEvalForm({ ...evalForm, prompt: event.target.value })
            }
            placeholder="Test prompt"
            rows={3}
            maxLength={10_000}
            required
            className="bg-background border-border w-full rounded-md border p-3 text-sm"
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Input
              value={evalForm.signals}
              onChange={(event) =>
                setEvalForm({ ...evalForm, signals: event.target.value })
              }
              placeholder="Expected signals (comma-separated)"
            />
            <Input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={evalForm.threshold}
              onChange={(event) =>
                setEvalForm({ ...evalForm, threshold: event.target.value })
              }
              aria-label="Pass threshold"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={createEvaluation.isPending || !evalForm.agentId}
            >
              {createEvaluation.isPending ? "Creating..." : "+ Evaluation"}
            </Button>
          </div>
        </form>
        {evaluations.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Agent</th>
                  <th className="py-2 pr-4">Threshold</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map((ev) => {
                  const evalAgent = agents.find((a) => a.id === ev.agentId);
                  return (
                    <tr key={ev.id} className="border-border/60 border-b">
                      <td className="py-3 pr-4 font-medium">{ev.name}</td>
                      <td className="py-3 pr-4">
                        {evalAgent?.name ?? "Unknown"}
                      </td>
                      <td className="py-3 pr-4">{ev.passThreshold}</td>
                      <td className="text-muted-foreground py-3 pr-4 text-xs">
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            runEvaluation.mutate({ evaluationId: ev.id })
                          }
                          disabled={runEvaluation.isPending}
                        >
                          {runEvaluation.isPending &&
                          runEvaluation.variables.evaluationId === ev.id
                            ? "Running..."
                            : "Run"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detailsAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDetailsAgent(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${detailsAgent.name} details`}
            className="bg-card border-border max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">{detailsAgent.name}</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Versions and tool grants
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailsAgent(null)}
                className="text-muted-foreground hover:text-foreground -mr-2 -mt-1 rounded-md p-2 text-sm"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold">Versions</h3>
                {versionsForAgent.length === 0 ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    No versions recorded yet.
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-left text-sm">
                      <thead className="text-muted-foreground border-border border-b text-xs">
                        <tr>
                          <th className="py-2 pr-4">Version</th>
                          <th className="py-2 pr-4">Model</th>
                          <th className="py-2 pr-4">Change</th>
                          <th className="py-2 pr-4">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {versionsForAgent.map((v) => (
                          <tr
                            key={v.id}
                            className="border-border/60 border-b"
                          >
                            <td className="py-3 pr-4 font-medium">
                              v{v.version}
                            </td>
                            <td className="py-3 pr-4 text-xs">
                              {v.modelProvider}/{v.modelName}
                            </td>
                            <td className="py-3 pr-4 text-xs">
                              {v.changeSummary}
                            </td>
                            <td className="text-muted-foreground py-3 pr-4 text-xs">
                              {new Date(v.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold">Tool Grants</h3>
                {grantsForAgent.length === 0 ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    No tools granted to this agent.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {grantsForAgent.map((g) => {
                      const tool = tools.find((t) => t.id === g.toolId);
                      return (
                        <li
                          key={g.id}
                          className="border-border flex items-center justify-between rounded-md border p-3 text-sm"
                        >
                          <span>
                            {tool?.displayName ?? g.toolId}
                            {tool ? (
                              <span className="text-muted-foreground ml-2 font-mono text-xs">
                                ({tool.name})
                              </span>
                            ) : null}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              revokeTool.mutate({ grantId: g.id })
                            }
                          >
                            Revoke
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <form
                  className="mt-3 flex items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!grantToolId) return;
                    grantTool.mutate({
                      agentId: detailsAgent.id,
                      toolId: grantToolId,
                    });
                  }}
                >
                  <label className="flex-1 space-y-1.5">
                    <span className="text-sm font-medium">Grant a tool</span>
                    <select
                      value={grantToolId}
                      onChange={(event) => setGrantToolId(event.target.value)}
                      className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
                    >
                      <option value="">Select a tool</option>
                      {tools
                        .filter(
                          (t) =>
                            !grantsForAgent.some((g) => g.toolId === t.id),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.displayName} ({t.name})
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button
                    type="submit"
                    disabled={grantTool.isPending || !grantToolId}
                  >
                    {grantTool.isPending ? "Granting..." : "Grant"}
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      <AgentFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        agent={editingAgent}
        onSaved={handleSaved}
      />
    </div>
  );
}

function formatBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url;
  }
}

function RunStat({
  label,
  icon,
  value,
  capitalize,
}: {
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  capitalize?: boolean;
}) {
  return (
    <div className="border-border/60 bg-muted/30 flex flex-col gap-2 rounded-lg border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
        <span className="flex shrink-0 items-center justify-center [&_svg]:size-3.5">
          {icon}
        </span>
        {label}
      </div>
      <div
        className={cn(
          "text-foreground text-sm font-medium leading-tight",
          capitalize && "capitalize",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function getInvestigation(value: unknown): InvestigationReportData | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const findings = Array.isArray(record.findings)
    ? record.findings.filter((finding): finding is string => {
        return typeof finding === "string";
      })
    : [];

  return {
    status:
      typeof record.status === "string" ? record.status : "completed",
    usedSplunkMcp: Boolean(record.usedSplunkMcp),
    query: typeof record.query === "string" ? record.query : "",
    summary: typeof record.summary === "string" ? record.summary : "",
    findings,
    riskLevel: typeof record.riskLevel === "string" ? record.riskLevel : "low",
  };
}
