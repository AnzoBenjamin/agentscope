"use client";

import { cn } from "@agentscope/ui";

export function AgentCard({
  name,
  description,
  modelProvider,
  modelName,
  status,
  sessionCount,
  reliability,
  onClick,
}: {
  name: string;
  description: string;
  modelProvider: string;
  modelName: string;
  status: string;
  sessionCount?: number;
  reliability?: number;
  onClick?: () => void;
}) {
  const statusColors: Record<string, string> = {
    Active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    Archived: "bg-muted text-muted-foreground border-border",
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-card border-border rounded-xl border p-6 shadow-sm transition-all",
        "hover:border-primary/30 hover:shadow-md",
        onClick && "cursor-pointer",
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">{name}</h3>
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
            {description}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold",
            statusColors[status] ?? statusColors.Active,
          )}
        >
          {status}
        </span>
      </div>

      <div className="text-muted-foreground flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-current" />
          {modelProvider} / {modelName}
        </span>
        {sessionCount !== undefined && <span>{sessionCount} sessions</span>}
        {reliability !== undefined && (
          <span
            className={cn(
              reliability >= 90
                ? "text-emerald-400"
                : reliability >= 70
                  ? "text-amber-400"
                  : "text-red-400",
            )}
          >
            {reliability}% reliable
          </span>
        )}
      </div>
    </div>
  );
}
