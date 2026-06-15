"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@agentscope/ui/button";
import { Input } from "@agentscope/ui/input";
import { Label } from "@agentscope/ui/label";
import { toast } from "@agentscope/ui/toast";

import { useDebouncedInput } from "~/hooks/use-debounced-input";
import { useTRPC } from "~/trpc/react";
import { CostBudgetEditModal } from "./_components/cost-budget-edit-modal";

const roles = ["Owner", "Admin", "Manager", "Member", "Viewer"] as const;
const plans = ["Starter", "Growth", "Enterprise"] as const;
const exportTypes = ["AuditLog", "Sessions", "Costs", "Runs"] as const;
const alertMetrics = [
  "RunFailed",
  "CostExceeded",
  "QueueBacklog",
  "SplunkNotReady",
] as const;

type PiiRedactionMode = "Off" | "Basic" | "Strict";

/**
 * Shape of the compliance policy as used by the settings UI. The DB column
 * for `piiRedactionMode` is `varchar`; tRPC infers `string` but the server
 * only writes values from the zod enum, so we narrow to the enum union at
 * the consumption point (see `compliancePolicy`).
 */
interface CompliancePolicyShape {
  retentionDays: number;
  requireSplunkEvidence: boolean;
  redactSensitivePayloads: boolean;
  allowAuditExports: boolean;
  immutableAudit: boolean;
  enforceRetention: boolean;
  exportRequiresApproval: boolean;
  piiRedactionMode: PiiRedactionMode;
}

type PolicyUpdateInput = CompliancePolicyShape;

/**
 * Build a complete compliance policy update payload from the current policy,
 * optionally overriding a subset of fields. Centralizing this ensures every
 * `updatePolicy.mutate(...)` call carries the full schema shape the API
 * expects (the router rejects partial inputs by design).
 */
function buildPolicyUpdate(
  current: CompliancePolicyShape,
  overrides: Partial<PolicyUpdateInput> = {},
): PolicyUpdateInput {
  return {
    retentionDays: current.retentionDays,
    requireSplunkEvidence: current.requireSplunkEvidence,
    redactSensitivePayloads: current.redactSensitivePayloads,
    allowAuditExports: current.allowAuditExports,
    immutableAudit: current.immutableAudit,
    enforceRetention: current.enforceRetention,
    exportRequiresApproval: current.exportRequiresApproval,
    piiRedactionMode: current.piiRedactionMode,
    ...overrides,
  };
}

export function SettingsContent() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const organization = useQuery(trpc.organization.current.queryOptions());
  const members = useQuery(trpc.auth.members.queryOptions());
  const invites = useQuery(trpc.auth.invites.queryOptions());
  const billing = useQuery(trpc.billing.summary.queryOptions());
  const policy = useQuery(trpc.compliance.policy.queryOptions());
  const auditLogs = useQuery(
    trpc.compliance.auditLogs.queryOptions({ limit: 25 }),
  );
  const exportsQuery = useQuery(trpc.compliance.exports.queryOptions());
  const evidenceRows = useQuery(
    trpc.compliance.evidence.queryOptions(),
  );
  const alertPolicies = useQuery(trpc.alerts.policies.queryOptions());
  const alertDeliveries = useQuery(
    trpc.alerts.deliveries.queryOptions({ limit: 20 }),
  );
  const operationsSummary = useQuery(
    trpc.analytics.operationsSummary.queryOptions(),
  );
  const queueHealth = useQuery(trpc.analytics.queueHealth.queryOptions());
  const modelCostBreakdown = useQuery(
    trpc.analytics.modelCostBreakdown.queryOptions(),
  );

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<(typeof roles)[number]>("Member");
  const [exportType, setExportType] =
    useState<(typeof exportTypes)[number]>("AuditLog");
  const [alertName, setAlertName] = useState("");
  const [alertMetric, setAlertMetric] =
    useState<(typeof alertMetrics)[number]>("RunFailed");
  const [alertThreshold, setAlertThreshold] = useState("1");
  const [alertTarget, setAlertTarget] = useState("");
  const [editingBudget, setEditingBudget] = useState<{
    id: string;
    name: string;
    period: string;
    maxCostCents: number;
    maxTokens: number;
    enforceHardCap: boolean;
    enabled: boolean;
  } | null>(null);

  const updateOrganization = useMutation(
    trpc.organization.update.mutationOptions({
      onSuccess: async () => {
        await invalidateSettings(queryClient, trpc);
        toast.success("Organization updated");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const inviteMember = useMutation(
    trpc.auth.inviteMember.mutationOptions({
      onSuccess: async (invite) => {
        setInviteEmail("");
        // Build the public invite link so the admin can share it manually
        // if the email delivery failed or is delayed.
        const appUrl =
          typeof window !== "undefined" ? window.location.origin : "";
        setLatestInvite({
          email: invite.email,
          role: invite.role,
          url: `${appUrl}/invites/${invite.token}`,
        });
        await invalidateSettings(queryClient, trpc);
        toast.success("Invite sent");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const [latestInvite, setLatestInvite] = useState<{
    email: string;
    role: string;
    url: string;
  } | null>(null);
  const updateMemberRole = useMutation(
    trpc.auth.updateMemberRole.mutationOptions({
      onSuccess: async () => {
        await invalidateSettings(queryClient, trpc);
        toast.success("Member role updated");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const removeMember = useMutation(
    trpc.auth.removeMember.mutationOptions({
      onSuccess: async () => {
        await invalidateSettings(queryClient, trpc);
        toast.success("Member removed");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const revokeInvite = useMutation(
    trpc.auth.revokeInvite.mutationOptions({
      onSuccess: async () => {
        await invalidateSettings(queryClient, trpc);
        toast.success("Invite revoked");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const checkout = useMutation(
    trpc.billing.createCheckoutSession.mutationOptions({
      onSuccess: (session) => {
        if (session.url) window.location.assign(session.url);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const updatePolicy = useMutation(
    trpc.compliance.updatePolicy.mutationOptions({
      onSuccess: async () => {
        await invalidateSettings(queryClient, trpc);
        toast.success("Compliance policy updated");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const createExport = useMutation(
    trpc.compliance.createExport.mutationOptions({
      onSuccess: async (created) => {
        await invalidateSettings(queryClient, trpc);
        if (created) downloadExport(created);
        toast.success("Export generated");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const createAlert = useMutation(
    trpc.alerts.createPolicy.mutationOptions({
      onSuccess: async () => {
        setAlertName("");
        setAlertTarget("");
        await invalidateSettings(queryClient, trpc);
        toast.success("Alert policy created");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const updateAlert = useMutation(
    trpc.alerts.updatePolicy.mutationOptions({
      onSuccess: async () => {
        await invalidateSettings(queryClient, trpc);
        toast.success("Alert policy updated");
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const deleteAlert = useMutation(
    trpc.alerts.deletePolicy.mutationOptions({
      onSuccess: async () => {
        await invalidateSettings(queryClient, trpc);
        toast.success("Alert policy deleted");
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  // Cost budgets: the router exposes `forAgent(agentId)`, so we scope the
  // section to one agent at a time.
  const [selectedBudgetAgentId, setSelectedBudgetAgentId] = useState("");
  const { data: budgetAgents = [] } = useQuery(
    trpc.agent.all.queryOptions(),
  );
  const { data: budgetsForAgent = [] } = useQuery({
    ...trpc.costBudget.forAgent.queryOptions({
      agentId: selectedBudgetAgentId,
    }),
    enabled: selectedBudgetAgentId !== "",
  });
  const [budgetForm, setBudgetForm] = useState({
    name: "",
    period: "Monthly",
    maxCostDollars: "10",
    maxTokens: "1000000",
    enforceHardCap: false,
    enabled: true,
  });

  // Compliance: legal holds + retention jobs + audit chain + analytics
  // insights + snapshots. Export approval is handled inline below using
  // the existing `exportsQuery` result.
  const { data: legalHolds = [] } = useQuery(
    trpc.compliance.legalHolds.queryOptions(),
  );
  const { data: retentionJobs = [] } = useQuery(
    trpc.compliance.retentionJobs.queryOptions(),
  );
  const [legalHoldForm, setLegalHoldForm] = useState({ name: "", reason: "" });
  // `auditChain` is derived from `verifyAuditChain.data` (see below) so we
  // don't have to sync query state into a `useState` via an effect.

  const { data: snapshots = [] } = useQuery(
    trpc.analytics.snapshots.queryOptions(),
  );
  const { data: insights = [] } = useQuery(
    trpc.analytics.insights.queryOptions(),
  );

  const createBudget = useMutation(
    trpc.costBudget.create.mutationOptions({
      onSuccess: async () => {
        setBudgetForm({
          name: "",
          period: "Monthly",
          maxCostDollars: "10",
          maxTokens: "1000000",
          enforceHardCap: false,
          enabled: true,
        });
        await queryClient.invalidateQueries(trpc.costBudget.pathFilter());
        toast.success("Cost budget created");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const deleteBudget = useMutation(
    trpc.costBudget.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.costBudget.pathFilter());
        toast.success("Cost budget deleted");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const createLegalHold = useMutation(
    trpc.compliance.createLegalHold.mutationOptions({
      onSuccess: async () => {
        setLegalHoldForm({ name: "", reason: "" });
        await queryClient.invalidateQueries(trpc.compliance.pathFilter());
        toast.success("Legal hold created");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const releaseLegalHold = useMutation(
    trpc.compliance.releaseLegalHold.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.compliance.pathFilter());
        toast.success("Legal hold released");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const runRetention = useMutation(
    trpc.compliance.runRetentionJob.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.compliance.pathFilter());
        toast.success("Retention job queued");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const approveExport = useMutation(
    trpc.compliance.approveExport.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.compliance.pathFilter());
        toast.success("Export approved");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  // `verifyAuditChain` is a `.query` procedure, so we model it as
  // `useQuery` with a manual trigger. Bumping the counter re-fetches.
  const [verifyTrigger, setVerifyTrigger] = useState(0);
  const verifyAuditChain = useQuery({
    ...trpc.compliance.verifyAuditChain.queryOptions(),
    enabled: verifyTrigger > 0,
  });
  // Derive the audit-chain verification result from the query data so the
  // display reads from a single source of truth (no setState-in-effect).
  const auditChain = verifyAuditChain.data ?? null;
  // Side effect: surface errors via toast. Not a setState call, so it
  // doesn't trip the react-hooks/set-state-in-effect lint rule.
  useEffect(() => {
    if (verifyAuditChain.error) toast.error(verifyAuditChain.error.message);
  }, [verifyAuditChain.error]);
  const generateInsights = useMutation(
    trpc.analytics.generateOperationalInsights.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.analytics.pathFilter());
        toast.success("Operational insights generated");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const currentOrg = organization.data;
  const effectiveOrgName = orgName !== "" ? orgName : (currentOrg?.name ?? "");
  const effectiveOrgSlug = orgSlug !== "" ? orgSlug : (currentOrg?.slug ?? "");
  // The DB column for `piiRedactionMode` is `varchar`; tRPC infers `string`
  // but the server only writes values from the zod enum, so we narrow at
  // the boundary.
  const compliancePolicy = policy.data as
    | CompliancePolicyShape
    | undefined;

  // Debounced retention input. The hook fires `onCommit` ~400ms after the
  // Read `prefill_*` search params (set by the dashboard anomaly panel's
  // "Create alert" link) and seed the alert form once. Re-runs are guarded
  // by a ref so a router re-render doesn't clobber user edits.
  const searchParams = useSearchParams();
  const prefillAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const metric = searchParams.get("prefill_metric");
    if (!metric) return;
    if (prefillAppliedRef.current === metric) return;
    prefillAppliedRef.current = metric;
    if (
      (alertMetrics as readonly string[]).includes(metric) &&
      metric !== alertMetric
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAlertMetric(metric as (typeof alertMetrics)[number]);
    }
    const threshold = searchParams.get("prefill_threshold");
    if (threshold !== null) setAlertThreshold(threshold);
    const name = searchParams.get("prefill_name");
    if (name !== null) setAlertName(name);
  }, [searchParams, alertMetric]);

  // Debounced retention input. The hook fires `onCommit` ~400ms after the
  // last keystroke; we suppress re-fires when the parsed value matches the
  // server's current retention (covers both the initial seed and the
  // post-mutation refetch).
  const retentionDaysInput = useDebouncedInput({
    initialValue: compliancePolicy
      ? String(compliancePolicy.retentionDays)
      : "",
    onCommit: (parsed) => {
      if (!compliancePolicy) return;
      if (parsed === compliancePolicy.retentionDays) return;
      updatePolicy.mutate(
        buildPolicyUpdate(compliancePolicy, { retentionDays: parsed }),
      );
    },
  });

  const usageByMetric = useMemo(() => {
    return Object.fromEntries(
      (billing.data?.usage ?? []).map((row) => [row.metric, row]),
    );
  }, [billing.data?.usage]);

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Organization administration, billing, compliance, alerts, and
          operational controls.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <MetricCard label="Queued Runs" value={queueHealth.data?.queued ?? 0} />
        <MetricCard
          label="Failed Alerts 24h"
          value={operationsSummary.data?.failedAlertDeliveries24h ?? 0}
        />
        <MetricCard
          label="Exports 24h"
          value={operationsSummary.data?.complianceExports24h ?? 0}
        />
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Organization</h2>
        <form
          className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            updateOrganization.mutate({
              name: effectiveOrgName,
              slug: effectiveOrgSlug,
            });
          }}
        >
          <Field label="Name">
            <Input
              value={effectiveOrgName}
              onChange={(event) => setOrgName(event.target.value)}
            />
          </Field>
          <Field label="Slug">
            <Input
              value={effectiveOrgSlug}
              onChange={(event) => setOrgSlug(event.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={updateOrganization.isPending}>
              Save
            </Button>
          </div>
        </form>
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Members</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Invite teammates and manage organization roles.
            </p>
          </div>
          <form
            className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_140px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              inviteMember.mutate({ email: inviteEmail, role: inviteRole });
            }}
          >
            <Input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
              aria-label="Invite email"
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as (typeof roles)[number])
              }
              className="bg-background border-border h-10 rounded-md border px-3 text-sm"
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={inviteMember.isPending}>
              Invite
            </Button>
          </form>
        </div>
        {latestInvite && (
          <div className="mt-4 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
            <p className="font-medium text-emerald-700 dark:text-emerald-400">
              Invite sent to {latestInvite.email} ({latestInvite.role})
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Share this link manually if the email is delayed or lost:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="bg-background flex-1 truncate rounded-md border px-2 py-1 font-mono text-xs">
                {latestInvite.url}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(latestInvite.url)
                    .then(() => toast.success("Invite link copied"))
                    .catch(() => toast.error("Copy failed"));
                }}
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLatestInvite(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-border text-muted-foreground border-b text-left text-xs">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {(members.data ?? []).map((item) => (
                <tr
                  key={item.membership.id}
                  className="border-border/60 border-b"
                >
                  <td className="py-3 pr-4">{item.user?.name ?? "Unknown"}</td>
                  <td className="py-3 pr-4">{item.user?.email ?? "-"}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={item.membership.role}
                      onChange={(event) =>
                        updateMemberRole.mutate({
                          memberId: item.membership.id,
                          role: event.target.value as (typeof roles)[number],
                        })
                      }
                      className="bg-background border-border h-9 rounded-md border px-2"
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 pr-4">{item.membership.status}</td>
                  <td className="py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        removeMember.mutate({ memberId: item.membership.id })
                      }
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(invites.data ?? []).length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold">Pending Invites</h3>
            <div className="mt-3 grid gap-2">
              {(invites.data ?? []).map((invite) => (
                <div
                  key={invite.id}
                  className="border-border flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <span>
                    {invite.email} - {invite.role} - {invite.status}
                  </span>
                  {invite.status === "Pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revokeInvite.mutate({ id: invite.id })}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Billing</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Current plan: {billing.data?.plan ?? "Starter"}; Stripe checkout{" "}
              {billing.data?.stripeConfigured ? "configured" : "not configured"}
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {plans.map((plan) => (
              <Button
                key={plan}
                variant={billing.data?.plan === plan ? "default" : "outline"}
                onClick={() => checkout.mutate({ plan })}
                disabled={checkout.isPending}
              >
                {plan}
              </Button>
            ))}
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Runs This Period"
            value={usageByMetric.agent_run?.quantity ?? 0}
          />
          <MetricCard
            label="Tokens This Period"
            value={(usageByMetric.tokens?.quantity ?? 0).toLocaleString()}
          />
          <MetricCard
            label="Model Cost This Period"
            value={`$${(
              (usageByMetric.model_cost?.costCents ?? 0) / 100
            ).toFixed(2)}`}
          />
        </div>
        <SimpleList
          title="Invoices"
          rows={(billing.data?.invoices ?? []).map((invoice) => ({
            id: invoice.id,
            label: `${invoice.number ?? invoice.stripeInvoiceId ?? invoice.id} - ${invoice.status}`,
            detail: `${invoice.currency.toUpperCase()} ${(invoice.totalCents / 100).toFixed(2)}`,
          }))}
        />
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Compliance</h2>
        {compliancePolicy && (
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <Field label="Retention Days">
              <Input
                type="number"
                value={retentionDaysInput.value}
                onChange={(event) => retentionDaysInput.setValue(event.target.value)}
              />
            </Field>
            <ToggleButton
              label="Require Splunk Evidence"
              enabled={compliancePolicy.requireSplunkEvidence}
              onClick={() =>
                updatePolicy.mutate(
                  buildPolicyUpdate(compliancePolicy, {
                    requireSplunkEvidence:
                      !compliancePolicy.requireSplunkEvidence,
                  }),
                )
              }
            />
            <ToggleButton
              label="Redact Sensitive Payloads"
              enabled={compliancePolicy.redactSensitivePayloads}
              onClick={() =>
                updatePolicy.mutate(
                  buildPolicyUpdate(compliancePolicy, {
                    redactSensitivePayloads:
                      !compliancePolicy.redactSensitivePayloads,
                  }),
                )
              }
            />
            <ToggleButton
              label="Allow Exports"
              enabled={compliancePolicy.allowAuditExports}
              onClick={() =>
                updatePolicy.mutate(
                  buildPolicyUpdate(compliancePolicy, {
                    allowAuditExports: !compliancePolicy.allowAuditExports,
                  }),
                )
              }
            />
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <select
            value={exportType}
            onChange={(event) =>
              setExportType(event.target.value as (typeof exportTypes)[number])
            }
            className="bg-background border-border h-10 rounded-md border px-3 text-sm"
          >
            {exportTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Button
            onClick={() =>
              createExport.mutate({ exportType, fileFormat: "csv" })
            }
            disabled={createExport.isPending}
          >
            Generate CSV
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              createExport.mutate({ exportType, fileFormat: "json" })
            }
            disabled={createExport.isPending}
          >
            Generate JSON
          </Button>
        </div>
        <SimpleList
          title="Recent Exports"
          rows={(exportsQuery.data ?? []).map((item) => ({
            id: item.id,
            label: `${item.exportType} ${item.fileFormat.toUpperCase()}`,
            detail: `${item.status} - ${new Date(item.createdAt).toLocaleString()}`,
            action: () => downloadExport(item),
          }))}
        />
        <SimpleList
          title="Audit Log"
          rows={(auditLogs.data ?? []).map((item) => ({
            id: item.id,
            label: `${item.action} on ${item.resourceType}`,
            detail: new Date(item.createdAt).toLocaleString(),
          }))}
        />
      </section>

      <section id="alerts" className="border-border bg-card rounded-xl border p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Alerts</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Deliver alerts by email or webhook when worker-run conditions are
              breached.
            </p>
          </div>
          <form
            className="grid gap-2 lg:grid-cols-[160px_150px_100px_minmax(220px,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              createAlert.mutate({
                name: alertName || `${alertMetric} alert`,
                metric: alertMetric,
                threshold: Number(alertThreshold),
                comparison: "gte",
                channel: alertTarget.startsWith("http") ? "Webhook" : "Email",
                target: alertTarget,
                enabled: true,
              });
            }}
          >
            <Input
              value={alertName}
              onChange={(event) => setAlertName(event.target.value)}
              placeholder="Name"
              aria-label="Alert name"
            />
            <select
              value={alertMetric}
              onChange={(event) =>
                setAlertMetric(
                  event.target.value as (typeof alertMetrics)[number],
                )
              }
              className="bg-background border-border h-10 rounded-md border px-3 text-sm"
            >
              {alertMetrics.map((metric) => (
                <option key={metric} value={metric}>
                  {metric}
                </option>
              ))}
            </select>
            <Input
              value={alertThreshold}
              onChange={(event) => setAlertThreshold(event.target.value)}
              aria-label="Alert threshold"
            />
            <Input
              value={alertTarget}
              onChange={(event) => setAlertTarget(event.target.value)}
              placeholder="ops@example.com or webhook URL"
              aria-label="Alert target"
            />
            <Button type="submit" disabled={createAlert.isPending}>
              Add
            </Button>
          </form>
        </div>
        <div className="mt-5 grid gap-3">
          {(alertPolicies.data ?? []).map((policy) => (
            <div
              key={policy.id}
              className="border-border flex flex-col gap-3 rounded-md border p-3 text-sm lg:flex-row lg:items-center lg:justify-between"
            >
              <span>
                {policy.name}: {policy.metric} {policy.comparison}{" "}
                {policy.threshold} to {policy.channel}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateAlert.mutate({
                      id: policy.id,
                      enabled: !policy.enabled,
                    })
                  }
                >
                  {policy.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deleteAlert.mutate({ id: policy.id })}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
        <SimpleList
          title="Recent Alert Deliveries"
          rows={(alertDeliveries.data ?? []).map((delivery) => ({
            id: delivery.id,
            label: `${delivery.status}: ${delivery.message}`,
            detail: new Date(delivery.createdAt).toLocaleString(),
          }))}
        />
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <h2 className="text-lg font-semibold">Operational Analytics</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-border text-muted-foreground border-b text-xs">
              <tr>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Model</th>
                <th className="py-2 pr-4">Calls</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {(modelCostBreakdown.data ?? []).map((row) => (
                <tr
                  key={`${row.provider}-${row.modelName}`}
                  className="border-border/60 border-b"
                >
                  <td className="py-3 pr-4">{row.provider}</td>
                  <td className="py-3 pr-4">{row.modelName}</td>
                  <td className="py-3 pr-4">{row.calls}</td>
                  <td className="py-3 pr-4">
                    {(row.tokensIn + row.tokensOut).toLocaleString()}
                  </td>
                  <td className="py-3">${row.totalCost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="cost-budgets" className="border-border bg-card rounded-xl border p-6">
        <div>
          <h2 className="text-lg font-semibold">Cost Budgets</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Per-agent spending caps. Hard caps block <code>enqueueRun</code>{" "}
            when exceeded.
          </p>
        </div>
        <label className="mt-5 block space-y-1.5">
          <span className="text-sm font-medium">Agent</span>
          <select
            value={selectedBudgetAgentId}
            onChange={(event) => setSelectedBudgetAgentId(event.target.value)}
            className="bg-background border-border h-10 w-full max-w-md rounded-md border px-3 text-sm"
          >
            <option value="">Select an agent</option>
            {budgetAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {selectedBudgetAgentId && (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              createBudget.mutate({
                agentId: selectedBudgetAgentId,
                name: budgetForm.name.trim(),
                period: budgetForm.period as
                  | "Hourly"
                  | "Daily"
                  | "Weekly"
                  | "Monthly",
                maxCostCents: Math.round(
                  Number.parseFloat(budgetForm.maxCostDollars) * 100,
                ),
                maxTokens: Number.parseInt(budgetForm.maxTokens, 10),
                enforceHardCap: budgetForm.enforceHardCap,
                enabled: budgetForm.enabled,
              });
            }}
          >
            <Input
              value={budgetForm.name}
              onChange={(event) =>
                setBudgetForm({ ...budgetForm, name: event.target.value })
              }
              placeholder="Monthly cap"
              minLength={2}
              maxLength={256}
              required
            />
            <select
              value={budgetForm.period}
              onChange={(event) =>
                setBudgetForm({ ...budgetForm, period: event.target.value })
              }
              className="bg-background border-border h-10 rounded-md border px-3 text-sm"
            >
              <option value="Hourly">Hourly</option>
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={budgetForm.maxCostDollars}
              onChange={(event) =>
                setBudgetForm({
                  ...budgetForm,
                  maxCostDollars: event.target.value,
                })
              }
              placeholder="USD"
            />
            <Input
              type="number"
              min="0"
              value={budgetForm.maxTokens}
              onChange={(event) =>
                setBudgetForm({ ...budgetForm, maxTokens: event.target.value })
              }
              placeholder="tokens"
            />
            <Button type="submit" disabled={createBudget.isPending}>
              {createBudget.isPending ? "Saving..." : "+ Budget"}
            </Button>
            <label className="text-muted-foreground col-span-full flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={budgetForm.enforceHardCap}
                onChange={(event) =>
                  setBudgetForm({
                    ...budgetForm,
                    enforceHardCap: event.target.checked,
                  })
                }
              />
              Enforce hard cap (block enqueueRun when exceeded)
            </label>
          </form>
        )}
        {budgetsForAgent.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Period</th>
                  <th className="py-2 pr-4">Max cost</th>
                  <th className="py-2 pr-4">Max tokens</th>
                  <th className="py-2 pr-4">Hard cap</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {budgetsForAgent.map((b) => (
                  <tr key={b.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 font-medium">{b.name}</td>
                    <td className="py-3 pr-4">{b.period}</td>
                    <td className="py-3 pr-4">
                      ${(b.maxCostCents / 100).toFixed(2)}
                    </td>
                    <td className="py-3 pr-4">
                      {b.maxTokens.toLocaleString()}
                    </td>
                    <td className="py-3 pr-4">
                      {b.enforceHardCap ? "Yes" : "No"}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingBudget(b)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (window.confirm(`Delete budget "${b.name}"?`)) {
                              deleteBudget.mutate({ id: b.id });
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <div>
          <h2 className="text-lg font-semibold">Legal Holds</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Active holds block retention jobs from deleting their sessions.
          </p>
        </div>
        <form
          className="mt-5 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            createLegalHold.mutate({
              name: legalHoldForm.name.trim(),
              reason: legalHoldForm.reason.trim(),
            });
          }}
        >
          <Input
            value={legalHoldForm.name}
            onChange={(event) =>
              setLegalHoldForm({ ...legalHoldForm, name: event.target.value })
            }
            placeholder="Case name"
            minLength={2}
            maxLength={256}
            required
          />
          <Input
            value={legalHoldForm.reason}
            onChange={(event) =>
              setLegalHoldForm({ ...legalHoldForm, reason: event.target.value })
            }
            placeholder="Reason"
            minLength={2}
            maxLength={4000}
            required
          />
          <Button type="submit" disabled={createLegalHold.isPending}>
            {createLegalHold.isPending ? "Saving..." : "+ Hold"}
          </Button>
        </form>
        {legalHolds.length > 0 && (
          <ul className="mt-4 space-y-2">
            {legalHolds.map((h) => (
              <li
                key={h.id}
                className="border-border flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{h.name}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {h.reason} —{" "}
                    {h.active
                      ? "Active"
                      : `Released ${
                          h.releasedAt
                            ? new Date(h.releasedAt).toLocaleString()
                            : ""
                        }`}
                  </p>
                </div>
                {h.active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => releaseLegalHold.mutate({ id: h.id })}
                  >
                    Release
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Data Retention</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Run retention to purge sessions older than the configured
              window. Active legal holds block deletion.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setVerifyTrigger((n) => n + 1)}
              disabled={verifyAuditChain.isFetching}
            >
              {verifyAuditChain.isFetching
                ? "Verifying..."
                : "Verify audit chain"}
            </Button>
            <Button
              onClick={() => runRetention.mutate(undefined)}
              disabled={runRetention.isPending}
            >
              {runRetention.isPending ? "Running..." : "Run retention"}
            </Button>
          </div>
        </div>
        {auditChain && (
          <div
            className={`mt-3 rounded-md border p-3 text-sm ${
              auditChain.valid
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
            }`}
          >
            {auditChain.valid
              ? `✓ Audit chain valid across ${auditChain.checked} entries.`
              : `✗ Audit chain broken at entry ${
                  auditChain.brokenAt ?? "unknown"
                } (${auditChain.checked} checked).`}
          </div>
        )}
        {retentionJobs.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b text-xs">
                <tr>
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Retention (days)</th>
                  <th className="py-2 pr-4">Deleted</th>
                  <th className="py-2">Skipped (hold)</th>
                </tr>
              </thead>
              <tbody>
                {retentionJobs.map((j) => (
                  <tr key={j.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 text-xs">
                      {j.startedAt
                        ? new Date(j.startedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-3 pr-4">{j.status}</td>
                    <td className="py-3 pr-4">{j.retentionDays}</td>
                    <td className="py-3 pr-4">
                      {j.deletedSessions + j.deletedEvents}
                    </td>
                    <td className="py-3 pr-4">{j.skippedByLegalHold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <div>
          <h2 className="text-lg font-semibold">Export Approval Queue</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Exports pending approval when the compliance policy requires it.
          </p>
        </div>
        {(
          (exportsQuery.data ?? []).filter(
            (e) => e.status === "PendingApproval",
          ).length === 0
        ) ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No pending exports.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {(exportsQuery.data ?? [])
              .filter((e) => e.status === "PendingApproval")
              .map((e) => (
                <li
                  key={e.id}
                  className="border-border flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                >
                  <span>
                    {e.exportType} · {e.fileFormat.toUpperCase()} ·{" "}
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => approveExport.mutate({ id: e.id })}
                    disabled={approveExport.isPending}
                  >
                    Approve
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Operational Insights</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Generate insights from the last 24h of run + alert + usage
              data.
            </p>
          </div>
          <Button
            onClick={() => generateInsights.mutate(undefined)}
            disabled={generateInsights.isPending}
          >
            {generateInsights.isPending
              ? "Generating..."
              : "Generate insights"}
          </Button>
        </div>
        {insights.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No insights yet. Click "Generate insights" to run analysis.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {insights.slice(0, 10).map((i) => (
              <li key={i.id} className="border-border rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{i.title}</span>
                  <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                    {i.severity}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {i.description}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {new Date(i.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
        {snapshots.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold">Recent snapshots</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-muted-foreground border-border border-b text-xs">
                  <tr>
                    <th className="py-2 pr-4">Window</th>
                    <th className="py-2 pr-4">Runs</th>
                    <th className="py-2 pr-4">Dead-lettered</th>
                    <th className="py-2 pr-4">Retrying</th>
                    <th className="py-2 pr-4">Cost (¢)</th>
                    <th className="py-2">Failed alerts</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.slice(0, 10).map((s) => {
                    const m = s.metrics as Record<string, number>;
                    return (
                      <tr key={s.id} className="border-border/60 border-b">
                        <td className="py-3 pr-4 text-xs">
                          {new Date(s.windowStart).toLocaleString()} -{" "}
                          {new Date(s.windowEnd).toLocaleString()}
                        </td>
                        <td className="py-3 pr-4">{m.runs ?? 0}</td>
                        <td className="py-3 pr-4">{m.deadLetters ?? 0}</td>
                        <td className="py-3 pr-4">{m.retrying ?? 0}</td>
                        <td className="py-3 pr-4">
                          {m.totalCostCents ?? 0}
                        </td>
                        <td className="py-3 pr-4">{m.failedAlerts ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <div>
          <h2 className="text-lg font-semibold">Compliance Evidence</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Row-level evidence records: audit-chain receipts, Splunk evidence
            pointers, and verification metadata. Auditor-facing.
          </p>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-muted-foreground border-border border-b text-xs">
              <tr>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Resource</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Hash</th>
                <th className="py-2 pr-4">URI</th>
                <th className="py-2">Verified</th>
              </tr>
            </thead>
            <tbody>
              {(evidenceRows.data ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-muted-foreground py-6 text-center text-sm"
                  >
                    No evidence records yet. Evidence is written by the
                    compliance engine when an action is captured by the
                    audit chain.
                  </td>
                </tr>
              ) : (
                (evidenceRows.data ?? []).map((row) => (
                  <tr key={row.id} className="border-border/60 border-b">
                    <td className="py-3 pr-4 text-xs">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      <span className="font-mono">
                        {row.resourceType}/{row.resourceId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="py-3 pr-4">{row.evidenceType}</td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      {row.payloadHash.slice(0, 12)}
                      {row.payloadHash.length > 12 ? "…" : ""}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      {row.evidenceUri ? (
                        <span className="font-mono break-all">
                          {row.evidenceUri}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 text-xs">
                      {row.verifiedAt
                        ? new Date(row.verifiedAt).toLocaleString()
                        : "Unverified"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-border bg-card rounded-xl border p-6">
        <h2 className="text-lg font-semibold">More settings</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Recurring agent runs, SSO/SCIM/API keys, and identity providers
          live on their own pages.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/schedules">Schedules →</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/security">Security →</Link>
          </Button>
        </div>
      </section>

      {editingBudget && (
        <CostBudgetEditModal
          budget={editingBudget}
          onClose={() => setEditingBudget(null)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border-border bg-card rounded-xl border p-5">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function ToggleButton({
  label,
  enabled,
  onClick,
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-end">
      <Button
        type="button"
        variant={enabled ? "default" : "outline"}
        onClick={onClick}
      >
        {label}: {enabled ? "On" : "Off"}
      </Button>
    </div>
  );
}

function SimpleList({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; label: string; detail?: string; action?: () => void }[];
}) {
  if (rows.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 grid gap-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className="border-border flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{row.label}</p>
              {row.detail && (
                <p className="text-muted-foreground mt-1 text-xs">
                  {row.detail}
                </p>
              )}
            </div>
            {row.action && (
              <Button variant="outline" size="sm" onClick={row.action}>
                Download
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function downloadExport(item: {
  id: string;
  content: string;
  fileFormat: string;
  exportType: string;
}) {
  const blob = new Blob([item.content], {
    type: item.fileFormat === "json" ? "application/json" : "text/csv",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.exportType}-${item.id}.${item.fileFormat}`;
  link.click();
  URL.revokeObjectURL(url);
}

async function invalidateSettings(
  queryClient: ReturnType<typeof useQueryClient>,
  trpc: ReturnType<typeof useTRPC>,
) {
  await Promise.all([
    queryClient.invalidateQueries(trpc.auth.pathFilter()),
    queryClient.invalidateQueries(trpc.organization.pathFilter()),
    queryClient.invalidateQueries(trpc.billing.pathFilter()),
    queryClient.invalidateQueries(trpc.compliance.pathFilter()),
    queryClient.invalidateQueries(trpc.alerts.pathFilter()),
    queryClient.invalidateQueries(trpc.analytics.pathFilter()),
    queryClient.invalidateQueries(trpc.costBudget.pathFilter()),
    queryClient.invalidateQueries(trpc.security.pathFilter()),
  ]);
}
