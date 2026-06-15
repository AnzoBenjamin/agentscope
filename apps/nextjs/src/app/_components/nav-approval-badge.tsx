"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

/**
 * Always-visible "Agents" nav link with an optional amber badge that
 * surfaces the count of runs awaiting Manager approval. The link is
 * always rendered so the user can navigate to the Agents page even when
 * no approvals are pending; the badge only appears when `pending.length > 0`.
 *
 * The pendingApprovals query is `requireRole("Manager")` so non-Managers
 * will see a permission error in the console — the badge silently stays
 * hidden in that case (caught by `error: null`).
 */
export function NavApprovalBadge() {
  const trpc = useTRPC();
  const { data: pending = [] } = useQuery({
    ...trpc.agent.pendingApprovals.queryOptions(),
    refetchInterval: 10_000,
    retry: false,
  });

  const hasPending = pending.length > 0;

  return (
    <Link
      href={hasPending ? "/agents#pending-approvals" : "/agents"}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
    >
      <span>Agents</span>
      {hasPending ? (
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
          {pending.length}
        </span>
      ) : null}
    </Link>
  );
}
