"use client";

import { cn } from "@agentscope/ui";

export function StatCard({
  label,
  value,
  subtitle,
  trend,
  icon,
  className,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  icon?: React.ReactNode;
  className?: string;
}) {
  const trendColors = {
    up: "text-emerald-500",
    down: "text-red-500",
    neutral: "text-muted-foreground",
  };

  return (
    <div
      className={cn(
        "bg-card border-border rounded-xl border p-6 shadow-sm transition-shadow hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm font-medium">{label}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
        </div>
        {icon && (
          <div className="bg-primary/10 text-primary rounded-lg p-2.5">
            {icon}
          </div>
        )}
      </div>
      {(subtitle ?? trend) && (
        <p
          className={cn(
            "mt-3 text-xs",
            trend ? trendColors[trend] : "text-muted-foreground",
          )}
        >
          {trend === "up" && "↑ "}
          {trend === "down" && "↓ "}
          {subtitle ?? (trend ? "vs last month" : "")}
        </p>
      )}
    </div>
  );
}
