"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

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

interface ScheduleForm {
  name: string;
  agentId: string;
  frequency: Frequency;
  cronExpression: string;
  inputPrompt: string;
  enabled: boolean;
}

const blank: ScheduleForm = {
  name: "",
  agentId: "",
  frequency: "Daily",
  cronExpression: "",
  inputPrompt: "",
  enabled: true,
};

export function SchedulesContent() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: schedules = [] } = useQuery(
    trpc.schedule.all.queryOptions(),
  );
  const { data: agents = [] } = useQuery(trpc.agent.all.queryOptions());

  const [addingOpen, setAddingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleForm>(blank);
  const [agentFilter, setAgentFilter] = useState("");

  const { data: history = [] } = useQuery({
    ...trpc.schedule.history.queryOptions({
      scheduleId: historyId ?? "",
      limit: 25,
    }),
    enabled: historyId !== null,
  });

  // Latest run per schedule, used to badge the schedule list with the
  // last-known status without requiring the user to expand history.
  const { data: latestRuns = [] } = useQuery(
    trpc.schedule.latestRuns.queryOptions(),
  );
  const latestRunBySchedule = new Map(
    latestRuns.map((run) => [run.scheduleId, run]),
  );

  const createSchedule = useMutation(
    trpc.schedule.create.mutationOptions({
      onSuccess: async () => {
        setAddingOpen(false);
        setForm(blank);
        await queryClient.invalidateQueries(trpc.schedule.pathFilter());
        toast.success("Schedule created");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const updateSchedule = useMutation(
    trpc.schedule.update.mutationOptions({
      onSuccess: async () => {
        setEditingId(null);
        await queryClient.invalidateQueries(trpc.schedule.pathFilter());
        toast.success("Schedule updated");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const deleteSchedule = useMutation(
    trpc.schedule.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.schedule.pathFilter());
        toast.success("Schedule deleted");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const filteredSchedules = agentFilter
    ? schedules.filter((s) => s.agentId === agentFilter)
    : schedules;

  const openEdit = (schedule: typeof schedules[number]) => {
    setEditingId(schedule.id);
    setForm({
      name: schedule.name,
      agentId: schedule.agentId,
      frequency: schedule.frequency as Frequency,
      cronExpression: schedule.cronExpression ?? "",
      inputPrompt: schedule.inputPrompt,
      enabled: schedule.enabled,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateSchedule.mutate({
        id: editingId,
        name: form.name,
        frequency: form.frequency,
        cronExpression: form.cronExpression || undefined,
        inputPrompt: form.inputPrompt,
        enabled: form.enabled,
      });
    } else {
      createSchedule.mutate({
        agentId: form.agentId,
        name: form.name,
        frequency: form.frequency,
        cronExpression: form.cronExpression || undefined,
        inputPrompt: form.inputPrompt,
        enabled: form.enabled,
      });
    }
  };

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedules</h1>
          <p className="text-muted-foreground mt-1">
            Automated agent runs on a recurring cadence
          </p>
        </div>
        <Button
          onClick={() => {
            setAddingOpen(!addingOpen);
            setEditingId(null);
            setForm(blank);
          }}
        >
          {addingOpen ? "Cancel" : "+ New schedule"}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Filter by agent:</label>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="bg-background border-border h-10 rounded-md border px-3 text-sm"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {addingOpen && (
        <ScheduleFormCard
          form={form}
          setForm={setForm}
          agents={agents}
          onSubmit={handleSubmit}
          onCancel={() => {
            setAddingOpen(false);
            setForm(blank);
          }}
          submitting={createSchedule.isPending}
        />
      )}

      {filteredSchedules.length === 0 ? (
        <div className="text-muted-foreground py-16 text-center">
          <p className="text-lg">No schedules yet</p>
          <p className="mt-1 text-sm">
            Create one to automate agent runs on a recurring cadence.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSchedules.map((s) => {
            const agent = agents.find((a) => a.id === s.agentId);
            const isEditing = editingId === s.id;
            return (
              <div
                key={s.id}
                className="bg-card border-border rounded-lg border p-4"
              >
                {isEditing ? (
                  <ScheduleFormCard
                    form={form}
                    setForm={setForm}
                    agents={agents}
                    onSubmit={handleSubmit}
                    onCancel={() => {
                      setEditingId(null);
                      setForm(blank);
                    }}
                    submitting={updateSchedule.isPending}
                  />
                ) : (
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {s.name}
                        </span>
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
                          {s.frequency}
                        </span>
                        {s.enabled ? (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            Enabled
                          </span>
                        ) : (
                          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                            Disabled
                          </span>
                        )}
                        {(() => {
                          const lastRun = latestRunBySchedule.get(s.id);
                          if (!lastRun) return null;
                          const statusStyles: Record<string, string> = {
                            Completed:
                              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                            Failed: "bg-red-500/10 text-red-700 dark:text-red-400",
                            Running: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
                            Retrying:
                              "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                          };
                          return (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                statusStyles[lastRun.status] ??
                                "bg-muted text-muted-foreground"
                              }`}
                              title={`Last run: ${new Date(
                                lastRun.triggeredAt,
                              ).toLocaleString()}`}
                            >
                              Last: {lastRun.status}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Agent: {agent?.name ?? "Unknown"} · Next run:{" "}
                        {new Date(s.nextRunAt).toLocaleString()}
                      </p>
                      {s.cronExpression && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Cron: <code>{s.cronExpression}</code>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/schedules/${s.id}`}>Open</Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setHistoryId(historyId === s.id ? null : s.id)
                        }
                      >
                        {historyId === s.id ? "Hide history" : "History"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(s)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete schedule "${s.name}"?`,
                            )
                          ) {
                            deleteSchedule.mutate({ id: s.id });
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
                {historyId === s.id && !isEditing && (
                  <div className="border-border mt-4 border-t pt-4">
                    <h4 className="text-sm font-semibold">Recent runs</h4>
                    {history.length === 0 ? (
                      <p className="text-muted-foreground mt-2 text-sm">
                        No history yet.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-sm">
                        {history.map((h) => (
                          <li
                            key={h.id}
                            className="text-muted-foreground"
                          >
                            {new Date(h.triggeredAt).toLocaleString()} —{" "}
                            {h.status}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScheduleFormCard({
  form,
  setForm,
  agents,
  onSubmit,
  onCancel,
  submitting,
}: {
  form: ScheduleForm;
  setForm: (f: ScheduleForm) => void;
  agents: { id: string; name: string }[];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="bg-card border-border space-y-4 rounded-lg border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Name</span>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={256}
            required
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Agent</span>
          <select
            value={form.agentId}
            onChange={(e) => setForm({ ...form, agentId: e.target.value })}
            required
            className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Select agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Frequency</span>
          <select
            value={form.frequency}
            onChange={(e) =>
              setForm({ ...form, frequency: e.target.value as Frequency })
            }
            className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-muted-foreground text-sm font-medium">
            Cron expression (Cron only)
          </span>
          <Input
            value={form.cronExpression}
            onChange={(e) =>
              setForm({ ...form, cronExpression: e.target.value })
            }
            placeholder="0 * * * *"
            maxLength={128}
          />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Input prompt</span>
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
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
        />
        Enabled
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save schedule"}
        </Button>
      </div>
    </form>
  );
}
