"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@agentscope/ui";

import { useTRPC } from "~/trpc/react";

interface AgentBudgetWidgetProps {
  agentId: string;
}

/**
 * At-a-glance cost budget for one agent. The server's
 * `costBudget.forAgent` returns all configured budgets; we render a row
 * per budget with a progress bar showing the current month's spend
 * against the cap. The current spend is derived from `agentStats` so the
 * user can anticipate a hard-cap block before they hit "Queue Run".
 */
export function AgentBudgetWidget({ agentId }: AgentBudgetWidgetProps) {
  const trpc = useTRPC();
  const { data: budgets = [] } = useQuery(
    trpc.costBudget.forAgent.queryOptions({ agentId }),
  );
  const { data: agentStats = [] } = useQuery(
    trpc.analytics.agentStats.queryOptions(),
  );

  if (budgets.length === 0) return null;

  const stats = agentStats.find((s) => s.agentId === agentId);
  // The agentStats cost is the *monthly* total spent by the agent. This
  // is a rough upper bound for "current" usage; per-period windows are
  // not currently tracked in the analytics layer.
  const spentCents = Math.round((stats?.totalCost ?? 0) * 100);

  return (
    <section className="bg-card border-border rounded-xl border p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cost Budgets</h2>
        <Link
          href="/settings#cost-budgets"
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          Manage in Settings →
        </Link>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Per-period spending caps. Hard caps block new runs when exceeded.
      </p>
      <div className="mt-5 space-y-4">
        {budgets.map((b) => {
          const maxCents = b.maxCostCents;
          const pct = maxCents > 0 ? Math.min(100, (spentCents / maxCents) * 100) : 0;
          const tone =
            pct >= 100
              ? "bg-red-500"
              : pct >= 80
                ? "bg-amber-500"
                : "bg-emerald-500";
          return (
            <div key={b.id}>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {b.period}
                  </span>
                  {b.enforceHardCap && (
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      HARD CAP
                    </span>
                  )}
                  {!b.enabled && (
                    <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                      DISABLED
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    "font-mono text-xs tabular-nums",
                    pct >= 100
                      ? "text-red-500"
                      : pct >= 80
                        ? "text-amber-500"
                        : "text-muted-foreground",
                  )}
                >
                  ${(spentCents / 100).toFixed(2)} / $
                  {(maxCents / 100).toFixed(2)}
                </span>
              </div>
              <div className="bg-muted mt-2 h-2 overflow-hidden rounded-full">
                <div
                  className={cn("h-full transition-all", tone)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
