"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

const FREQUENCIES = [
  "Hourly",
  "Daily",
  "Weekly",
  "Monthly",
  "Once",
  "Cron",
] as const;
type Frequency = (typeof FREQUENCIES)[number];

interface ScheduleDetailContentProps {
  scheduleId: string;
}

export function ScheduleDetailContent({
  scheduleId,
}: ScheduleDetailContentProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: schedule } = useQuery(
    trpc.schedule.byId.queryOptions({ id: scheduleId }),
  );
  const { data: agents = [] } = useQuery(trpc.agent.all.queryOptions());
  const { data: history = [] } = useQuery(
    trpc.schedule.history.queryOptions({ scheduleId, limit: 50 }),
  );
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    frequency: "Daily" as Frequency,
    cronExpression: "",
    inputPrompt: "",
    enabled: true,
  });

  const update = useMutation(
    trpc.schedule.update.mutationOptions({
      onSuccess: async () => {
        setEditing(false);
        await queryClient.invalidateQueries(trpc.schedule.pathFilter());
        toast.success("Schedule updated");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const remove = useMutation(
    trpc.schedule.delete.mutationOptions({
      onSuccess: async () => {
        toast.success("Schedule deleted");
        await queryClient.invalidateQueries(trpc.schedule.pathFilter());
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  if (schedule === undefined) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="bg-muted h-8 w-64 animate-pulse rounded-md" />
      </div>
    );
  }

  const agent = agents.find((a) => a.id === schedule.agentId);
  const successCount = history.filter(
    (h) => h.status === "Completed" || h.status === "Queued",
  ).length;
  const errorCount = history.filter((h) => h.status === "Failed").length;

  const startEdit = () => {
    setForm({
      name: schedule.name,
      frequency: schedule.frequency as Frequency,
      cronExpression: schedule.cronExpression ?? "",
      inputPrompt: schedule.inputPrompt,
      enabled: schedule.enabled,
    });
    setEditing(true);
  };

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div>
        <div className="text-muted-foreground mb-2 text-sm">
          <Link href="/schedules" className="hover:text-foreground">
            Schedules
          </Link>{" "}
          / {schedule.name}
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">
                {schedule.name}
              </h1>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                {schedule.frequency}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  schedule.enabled
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {schedule.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p className="text-muted-foreground mt-1">
              Agent:{" "}
              {agent ? (
                <Link
                  href={`/agents/${agent.id}`}
                  className="text-primary hover:underline"
                >
                  {agent.name}
                </Link>
              ) : (
                "Unknown"
              )}
            </p>
            <p className="text-muted-foreground text-sm">
              Next run: {new Date(schedule.nextRunAt).toLocaleString()}
              {schedule.lastRunAt &&
                ` · Last run: ${new Date(schedule.lastRunAt).toLocaleString()}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={startEdit}
              disabled={editing}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm(`Delete schedule "${schedule.name}"?`)) {
                  remove.mutate({ id: schedule.id });
                }
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>

      <section className="bg-card border-border grid gap-4 rounded-xl border p-6 sm:grid-cols-3">
        <div>
          <p className="text-muted-foreground text-sm">Total runs</p>
          <p className="mt-2 text-2xl font-bold">{history.length}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Successful</p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">
            {successCount}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Failed</p>
          <p className="mt-2 text-2xl font-bold text-red-400">{errorCount}</p>
        </div>
      </section>

      {editing ? (
        <section className="bg-card border-border rounded-xl border p-6">
          <h2 className="text-lg font-semibold">Edit schedule</h2>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate({
                id: schedule.id,
                name: form.name,
                frequency: form.frequency,
                cronExpression: form.cronExpression || undefined,
                inputPrompt: form.inputPrompt,
                enabled: form.enabled,
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  maxLength={256}
                  required
                />
              </Field>
              <Field label="Frequency">
                <select
                  value={form.frequency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      frequency: e.target.value as Frequency,
                    })
                  }
                  className="bg-background border-border h-10 rounded-md border px-3 text-sm"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Cron expression (Cron only)">
              <Input
                value={form.cronExpression}
                onChange={(e) =>
                  setForm({ ...form, cronExpression: e.target.value })
                }
                placeholder="0 * * * *"
                maxLength={128}
              />
            </Field>
            <Field label="Input prompt">
              <textarea
                value={form.inputPrompt}
                onChange={(e) =>
                  setForm({ ...form, inputPrompt: e.target.value })
                }
                rows={3}
                maxLength={4096}
                required
                className="bg-background border-border w-full rounded-md border p-3 text-sm"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) =>
                  setForm({ ...form, enabled: e.target.checked })
                }
              />
              Enabled
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={update.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </section>
      ) : (
        <section className="bg-card border-border rounded-xl border p-6">
          <h2 className="text-lg font-semibold">Configuration</h2>
          <div className="mt-4 space-y-3">
            <Field label="Input prompt" value={schedule.inputPrompt} block />
            {schedule.cronExpression && (
              <Field
                label="Cron expression"
                value={schedule.cronExpression}
                mono
              />
            )}
          </div>
        </section>
      )}

      <section className="bg-card border-border rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Run history</h2>
        {history.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            No history yet. The worker will trigger this schedule on its next
            run.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th className="py-2 pr-4">Triggered</th>
                  <th className="py-2 pr-4">Scheduled for</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 text-xs">
                      {new Date(h.triggeredAt).toLocaleString()}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {new Date(h.scheduledFor).toLocaleString()}
                    </td>
                    <td className="py-3 pr-4">{h.status}</td>
                    <td className="text-muted-foreground py-3 pr-4 text-xs">
                      {h.error ?? "—"}
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

function Field({
  label,
  value,
  block,
  mono,
  children,
}: {
  label: string;
  value?: string;
  block?: boolean;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      {children ?? (
        <p
          className={`mt-1 text-sm ${
            mono ? "font-mono text-xs" : "font-medium"
          } ${block ? "whitespace-pre-wrap" : ""}`}
        >
          {value}
        </p>
      )}
    </div>
  );
}
