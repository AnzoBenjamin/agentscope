"use client";

import { useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import { AnomalyPanel } from "./anomaly-panel";
import { BarChart, SimpleLineChart } from "./charts";
import { LiveActivityFeed } from "./live-activity-feed";
import { LiveEventStream } from "./live-event-stream";
import { SplunkHealthPanel } from "./splunk-health-panel";
import { SplunkQuickStats } from "./splunk-quick-stats";
import { SplunkSearchPanel } from "./splunk-search-panel";
import { StatCard } from "./stat-card";

export function DashboardContent() {
  const trpc = useTRPC();
  const { data: summary } = useSuspenseQuery(
    trpc.analytics.dashboardSummary.queryOptions(),
  );
  const { data: agentStats } = useSuspenseQuery(
    trpc.analytics.agentStats.queryOptions(),
  );
  const { data: costHistory } = useSuspenseQuery(
    trpc.analytics.costHistory.queryOptions(),
  );
  const { data: queueHealth } = useSuspenseQuery(
    trpc.analytics.queueHealth.queryOptions(),
  );
  const { data: modelCostBreakdown } = useSuspenseQuery(
    trpc.analytics.modelCostBreakdown.queryOptions(),
  );
  const { data: reliabilityTrend } = useSuspenseQuery(
    trpc.analytics.reliabilityTrend.queryOptions(),
  );

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Executive Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Overview of your AI workforce — powered by Splunk observability
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Agents"
          value={summary.activeAgents}
          subtitle={`${summary.totalAgents} total deployed`}
          icon={<AgentIcon />}
        />
        <StatCard
          label="Tasks Completed"
          value={summary.completedTasks}
          trend={summary.completedTasks > 0 ? "up" : "neutral"}
          icon={<CheckIcon />}
        />
        <StatCard
          label="Monthly Cost"
          value={`$${summary.totalCost.toFixed(2)}`}
          subtitle={`${summary.totalTokens.toLocaleString()} tokens`}
          icon={<DollarIcon />}
        />
        <StatCard
          label="Reliability Score"
          value={`${summary.reliabilityScore}%`}
          trend={summary.reliabilityScore >= 90 ? "up" : "down"}
          icon={<ShieldIcon />}
        />
      </div>

      <SplunkHealthPanel />

      <SplunkQuickStats />

      <SplunkSearchPanel />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Queued Runs"
          value={queueHealth.queued}
          subtitle={`${queueHealth.retrying} retrying`}
          icon={<QueueIcon />}
        />
        <StatCard
          label="Running Jobs"
          value={queueHealth.running}
          subtitle={`${queueHealth.failed} failed recently`}
          icon={<AgentIcon />}
        />
        <StatCard
          label="Models In Use"
          value={modelCostBreakdown.length}
          subtitle="cost attribution"
          icon={<DollarIcon />}
        />
        <StatCard
          label="Latest Reliability"
          value={`${reliabilityTrend.at(-1)?.reliability ?? 100}%`}
          subtitle={reliabilityTrend.at(-1)?.date ?? "No sessions"}
          icon={<ShieldIcon />}
        />
      </div>

      {/* Charts + Anomaly Detection */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Bar Chart - Agent Utilization */}
        <div className="bg-card border-border rounded-xl border p-6">
          <BarChart
            title="Agent Utilization"
            data={agentStats.slice(0, 6).map((s) => ({
              label: s.agentName,
              value: s.totalSessions,
              color: "bg-primary",
            }))}
          />
        </div>

        {/* Line Chart - Cost Over Time */}
        <div className="bg-card border-border rounded-xl border p-6">
          <SimpleLineChart
            title="Cost Trend"
            data={costHistory.map((c) => ({
              label: c.date ?? "",
              value: c.cost,
            }))}
          />
        </div>

        {/* Anomaly Detection Panel */}
        <AnomalyPanel />
      </div>

      {/* Agent Scorecards */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Agent Scorecards</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agentStats.slice(0, 6).map((stat) => (
            <div
              key={stat.agentId}
              className="bg-card border-border rounded-xl border p-5"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{stat.agentName}</h3>
                  <p className="text-muted-foreground text-xs">
                    {stat.modelProvider}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                    stat.status === "Active"
                      ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                      : "bg-muted text-muted-foreground border-border border"
                  }`}
                >
                  {stat.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground text-xs">Reliability</p>
                  <p
                    className={`text-lg font-bold ${
                      stat.reliability >= 90
                        ? "text-emerald-400"
                        : stat.reliability >= 70
                          ? "text-amber-400"
                          : "text-red-400"
                    }`}
                  >
                    {stat.reliability}%
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Monthly Cost</p>
                  <p className="text-lg font-bold">
                    ${stat.totalCost.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Efficiency</p>
                  <p className="text-lg font-bold">{stat.efficiency}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Sessions</p>
                  <p className="text-lg font-bold">{stat.totalSessions}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <LiveActivityFeed />
        <LiveEventStream organizationId={summary.organizationId} />
        <div className="bg-card border-border rounded-xl border p-6">
          <h2 className="text-lg font-semibold">Model Cost Breakdown</h2>
          <div className="mt-4 space-y-3">
            {modelCostBreakdown.map((row) => (
              <div
                key={`${row.provider}-${row.modelName}`}
                className="border-border/60 flex items-center justify-between gap-4 border-b pb-3 text-sm"
              >
                <div>
                  <p className="font-medium">{row.modelName}</p>
                  <p className="text-muted-foreground text-xs">
                    {row.provider} - {row.calls} calls
                  </p>
                </div>
                <p className="font-semibold">${row.totalCost.toFixed(4)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-card border-border rounded-xl border p-6">
          <SimpleLineChart
            title="Reliability Trend"
            data={reliabilityTrend.map((item) => ({
              label: item.date,
              value: item.reliability,
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function QueueIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
