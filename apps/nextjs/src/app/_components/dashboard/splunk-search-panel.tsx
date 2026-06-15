"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

type SearchMode = "mcp" | "direct";

export function SplunkSearchPanel() {
  const trpc = useTRPC();
  const [mode, setMode] = useState<SearchMode>("mcp");
  const [query, setQuery] = useState(
    "search index=main sourcetype=agentscope:event | head 20",
  );
  // Manual trigger: when `args` is null, no query runs. Setting args fires
  // a single fetch. Both procedures are `.query` endpoints, so useQuery
  // with `enabled` is the right pattern (useMutation would call
  // `.mutationOptions()` which doesn't exist on a QueryProcedure).
  const [args, setArgs] = useState<{ query: string } | null>(null);

  const mcpSearch = useQuery({
    ...trpc.splunk.mcpSearch.queryOptions(
      args ?? { query: "" },
    ),
    enabled: args !== null && mode === "mcp",
  });
  const directSearch = useQuery({
    ...trpc.splunk.search.queryOptions(
      args ?? { query: "" },
    ),
    enabled: args !== null && mode === "direct",
  });

  // Side effect: surface errors via toast. Not a setState call, so it
  // doesn't trip the react-hooks/set-state-in-effect lint rule.
  useEffect(() => {
    if (mcpSearch.error) toast.error(mcpSearch.error.message);
  }, [mcpSearch.error]);
  useEffect(() => {
    if (directSearch.error) toast.error(directSearch.error.message);
  }, [directSearch.error]);

  const runSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setArgs({ query: trimmed });
  };

  // Derive the active result from the current mode's query data so we don't
  // have to sync query data into local state via an effect.
  const activeData = mode === "mcp" ? mcpSearch.data : directSearch.data;
  const isPending = mcpSearch.isFetching || directSearch.isFetching;
  const resultText = (() => {
    if (activeData === undefined) return "";
    try {
      return JSON.stringify(activeData, null, 2);
    } catch {
      return "[unserializable]";
    }
  })();

  return (
    <div className="bg-card border-border rounded-xl border p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Splunk Search</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Run ad-hoc SPL against the events index. MCP goes through the
            model-context server; direct hits the management API.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("mcp")}
            className={`rounded-sm px-2 py-1 ${
              mode === "mcp"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            }`}
          >
            MCP
          </button>
          <button
            type="button"
            onClick={() => setMode("direct")}
            className={`rounded-sm px-2 py-1 ${
              mode === "direct"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            }`}
          >
            Direct
          </button>
        </div>
      </div>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={runSearch}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="search index=main ..."
          className="flex-1"
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? "Searching..." : "Search"}
        </Button>
      </form>
      {resultText !== "" && (
        <pre className="bg-muted mt-4 max-h-80 overflow-auto rounded-md p-3 text-xs">
          <code>{resultText}</code>
        </pre>
      )}
    </div>
  );
}
