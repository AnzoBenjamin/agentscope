"use client";

import { useMemo } from "react";

import { cn } from "@agentscope/ui";

interface BarChartData {
  label: string;
  value: number;
  maxValue?: number;
  color?: string;
  displayValue?: string;
}

export function BarChart({
  data,
  title,
  className,
}: {
  data: BarChartData[];
  title?: string;
  className?: string;
}) {
  const max = useMemo(
    () =>
      Math.max(
        ...data.map((d) => d.maxValue ?? d.value),
        ...data.map((d) => d.value),
        1,
      ),
    [data],
  );

  return (
    <div className={cn("space-y-4", className)}>
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="space-y-3">
        {data.map((item, i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-medium tabular-nums">
                {item.displayValue ?? item.value}
              </span>
            </div>
            <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  item.color ?? "bg-primary",
                )}
                style={{
                  width: `${Math.min((item.value / max) * 100, 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SimpleLineChart({
  data,
  title,
  className,
}: {
  data: { label: string; value: number }[];
  title?: string;
  className?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1 || 1)) * 100;
      const y = 100 - ((d.value - min) / range) * 80 - 10;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className={cn("space-y-3", className)}>
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="relative h-32">
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full"
          preserveAspectRatio="none"
        >
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            className="text-primary"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="text-muted-foreground flex justify-between text-xs">
        {data.length > 0 && (
          <>
            <span>{data[0]?.label}</span>
            <span>{data[data.length - 1]?.label}</span>
          </>
        )}
      </div>
    </div>
  );
}
