"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

/**
 * Org-wide tool library. Lists every tool definition and, for each, the
 * number of agents that currently hold a grant. Operators can:
 *   1. Create a new tool definition
 *   2. Toggle a tool enabled/disabled (via the existing per-agent grants)
 *   3. Revoke a single grant
 *   4. Revoke ALL grants for a tool (the "kill switch" — useful when a
 *      tool is found to be buggy and you need to stop every agent from
 *      calling it immediately).
 */
export function ToolsContent() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: tools = [] } = useQuery(trpc.agent.tools.queryOptions());
  const { data: grants = [] } = useQuery(
    trpc.agent.allGrants.queryOptions(),
  );
  const { data: agents = [] } = useQuery(trpc.agent.all.queryOptions());

  const [toolForm, setToolForm] = useState({
    name: "",
    displayName: "",
    description: "",
  });
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

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

  const revokeOne = useMutation(
    trpc.agent.revokeTool.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success("Grant revoked");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const revokeAll = useMutation(
    trpc.agent.revokeAllToolGrants.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries(trpc.agent.pathFilter());
        toast.success(`Revoked ${result.revokedCount} grant(s)`);
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const grantsByTool = new Map<string, typeof grants>();
  for (const grant of grants) {
    const list = grantsByTool.get(grant.toolId) ?? [];
    list.push(grant);
    grantsByTool.set(grant.toolId, list);
  }

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tool Library</h1>
        <p className="text-muted-foreground mt-1">
          Org-wide tool definitions and the agents that hold grants for them.
        </p>
      </div>

      <section className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Create tool</h2>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            createTool.mutate({
              name: toolForm.name.trim(),
              displayName: toolForm.displayName.trim(),
              description: toolForm.description.trim() || undefined,
            });
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Name (snake_case)</span>
            <Input
              value={toolForm.name}
              onChange={(event) =>
                setToolForm({ ...toolForm, name: event.target.value })
              }
              placeholder="lookup_ticket"
              minLength={2}
              maxLength={128}
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Display name</span>
            <Input
              value={toolForm.displayName}
              onChange={(event) =>
                setToolForm({ ...toolForm, displayName: event.target.value })
              }
              placeholder="Lookup Ticket"
              minLength={2}
              maxLength={256}
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Description</span>
            <Input
              value={toolForm.description}
              onChange={(event) =>
                setToolForm({ ...toolForm, description: event.target.value })
              }
              placeholder="What the tool does"
              maxLength={2000}
            />
          </label>
          <Button type="submit" disabled={createTool.isPending}>
            {createTool.isPending ? "Creating..." : "+ Tool"}
          </Button>
        </form>
      </section>

      <section className="bg-card border-border rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">All tools</h2>
          <span className="text-muted-foreground text-xs">
            {tools.length} tool{tools.length === 1 ? "" : "s"} ·{" "}
            {grants.length} active grant{grants.length === 1 ? "" : "s"}
          </span>
        </div>
        {tools.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No tools defined yet. Create one above to make it available for
            granting to agents.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {tools.map((tool) => {
              const toolGrants = grantsByTool.get(tool.id) ?? [];
              const expanded = expandedToolId === tool.id;
              return (
                <div
                  key={tool.id}
                  className="border-border rounded-md border"
                >
                  <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{tool.name}</span>
                        <span className="font-medium">{tool.displayName}</span>
                        {tool.enabled ? (
                          <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                            Enabled
                          </span>
                        ) : (
                          <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                            Disabled
                          </span>
                        )}
                        <span className="text-muted-foreground text-xs">
                          {toolGrants.length} grant
                          {toolGrants.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {tool.description && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {tool.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setExpandedToolId(expanded ? null : tool.id)
                        }
                      >
                        {expanded ? "Hide grants" : "View grants"}
                      </Button>
                      {toolGrants.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={revokeAll.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke ALL ${toolGrants.length} grant(s) for "${tool.displayName}"? Agents will lose access immediately.`,
                              )
                            ) {
                              revokeAll.mutate({ toolId: tool.id });
                            }
                          }}
                        >
                          {revokeAll.isPending
                            ? "Revoking..."
                            : "Revoke from all"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-border bg-muted/30 border-t p-3">
                      {toolGrants.length === 0 ? (
                        <p className="text-muted-foreground text-xs">
                          No agents currently hold this tool.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {toolGrants.map((g) => {
                            const agent = agents.find(
                              (a) => a.id === g.agentId,
                            );
                            return (
                              <li
                                key={g.id}
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span className="flex items-center gap-2">
                                  {agent ? (
                                    <Link
                                      href={`/agents/${agent.id}`}
                                      className="text-primary font-medium hover:underline"
                                    >
                                      {agent.name}
                                    </Link>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      Unknown agent
                                    </span>
                                  )}
                                  <span className="text-muted-foreground text-xs">
                                    granted{" "}
                                    {new Date(g.createdAt).toLocaleDateString()}
                                  </span>
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  disabled={revokeOne.isPending}
                                  onClick={() =>
                                    revokeOne.mutate({ grantId: g.id })
                                  }
                                >
                                  Revoke
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
