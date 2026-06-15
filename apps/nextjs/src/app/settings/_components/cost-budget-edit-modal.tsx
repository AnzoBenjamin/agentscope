"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { toast } from "@agentscope/ui/toast";

import { useTRPC } from "~/trpc/react";

const PERIODS = ["Hourly", "Daily", "Weekly", "Monthly"] as const;
type Period = (typeof PERIODS)[number];

interface CostBudgetEditModalProps {
  budget: {
    id: string;
    name: string;
    period: string;
    maxCostCents: number;
    maxTokens: number;
    enforceHardCap: boolean;
    enabled: boolean;
  };
  onClose: () => void;
}

export function CostBudgetEditModal({
  budget,
  onClose,
}: CostBudgetEditModalProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: budget.name,
    period: budget.period as Period,
    maxCostDollars: (budget.maxCostCents / 100).toString(),
    maxTokens: String(budget.maxTokens),
    enforceHardCap: budget.enforceHardCap,
    enabled: budget.enabled,
  });

  const update = useMutation(
    trpc.costBudget.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.costBudget.pathFilter());
        toast.success("Cost budget updated");
        onClose();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit cost budget"
        className="bg-card border-border w-full max-w-lg rounded-xl border p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Edit cost budget</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Update caps, enforcement, and enabled state.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground -mr-2 -mt-1 rounded-md p-2 text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({
              id: budget.id,
              name: form.name.trim(),
              maxCostCents: Math.round(
                Number.parseFloat(form.maxCostDollars) * 100,
              ),
              maxTokens: Number.parseInt(form.maxTokens, 10),
              enforceHardCap: form.enforceHardCap,
              enabled: form.enabled,
            });
          }}
        >
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              minLength={2}
              maxLength={256}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Period</Label>
              <select
                value={form.period}
                onChange={(e) =>
                  setForm({ ...form, period: e.target.value as Period })
                }
                className="bg-background border-border h-10 w-full rounded-md border px-3 text-sm"
                disabled
                title="Period is fixed once a budget is created"
              >
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">
                Period can't be changed — delete and recreate instead.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Max cost (USD)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.maxCostDollars}
                onChange={(e) =>
                  setForm({ ...form, maxCostDollars: e.target.value })
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Max tokens</Label>
            <Input
              type="number"
              min="0"
              value={form.maxTokens}
              onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enforceHardCap}
                onChange={(e) =>
                  setForm({ ...form, enforceHardCap: e.target.checked })
                }
              />
              Enforce hard cap (block enqueueRun when exceeded)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) =>
                  setForm({ ...form, enabled: e.target.checked })
                }
              />
              Enabled
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-medium">{children}</label>;
}
