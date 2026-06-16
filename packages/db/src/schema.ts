import { sql } from "drizzle-orm";
import { index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "./auth-schema";

export const ORGANIZATION_ROLES = [
  "Owner",
  "Admin",
  "Manager",
  "Member",
  "Viewer",
] as const;

export const AGENT_RUN_STATUSES = [
  "AwaitingApproval",
  "Queued",
  "Running",
  "Retrying",
  "Completed",
  "Failed",
  "Cancelled",
  "DeadLettered",
] as const;

export const AGENT_TYPES = [
  "Research",
  "Reliability",
  "CostAnalyst",
  "Security",
  "Custom",
] as const;

export const AGENT_TOOL_SCOPES = [
  "ReadTelemetry",
  "SearchSplunk",
  "SendNotification",
  "WriteTicket",
  "Custom",
] as const;

export const APPROVAL_STATUSES = [
  "Pending",
  "Approved",
  "Rejected",
  "Expired",
] as const;

export const EVAL_RUN_STATUSES = [
  "Queued",
  "Running",
  "Passed",
  "Failed",
  "Errored",
] as const;

export const OUTBOX_STATUSES = [
  "Pending",
  "Sending",
  "Delivered",
  "Failed",
  "DeadLettered",
] as const;

export const BILLING_PLANS = [
  "Free",
  "Starter",
  "Growth",
  "Enterprise",
] as const;

export const SUBSCRIPTION_STATUSES = [
  "Trialing",
  "Active",
  "PastDue",
  "Cancelled",
  "Incomplete",
] as const;

export const INVOICE_STATUSES = [
  "Draft",
  "Open",
  "Paid",
  "Void",
  "Uncollectible",
] as const;

export const ALERT_CHANNELS = ["Email", "Webhook"] as const;

export const ALERT_METRICS = [
  "RunFailed",
  "CostExceeded",
  "QueueBacklog",
  "SplunkNotReady",
] as const;

export const AGENT_COST_BUDGET_PERIODS = [
  "Hourly",
  "Daily",
  "Weekly",
  "Monthly",
] as const;

export const AGENT_SCHEDULE_FREQUENCIES = [
  "Once",
  "Hourly",
  "Daily",
  "Weekly",
  "Monthly",
  "Cron",
] as const;

export const COMPLIANCE_EXPORT_TYPES = [
  "AuditLog",
  "Sessions",
  "Costs",
  "Runs",
] as const;

export const IDENTITY_PROVIDER_TYPES = ["SAML", "OIDC"] as const;

export const API_KEY_STATUSES = ["Active", "Revoked"] as const;

export const STREAM_EVENT_TYPES = [
  "agent_run.created",
  "agent_run.started",
  "agent_run.completed",
  "agent_run.failed",
  "agent_run.cancelled",
  "agent_run.dead_lettered",
  "agent_session.started",
  "agent_session.completed",
  "agent_session.failed",
  "telemetry.event",
  "alert.delivered",
  "cost.recorded",
  "splunk.investigation.completed",
] as const;

// AgentScope tables

export const Organization = pgTable("organization", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  name: t.varchar({ length: 256 }).notNull(),
  slug: t.varchar({ length: 128 }).notNull().unique(),
  plan: t.varchar({ length: 64 }).notNull().default("Starter"),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const OrganizationMember = pgTable(
  "organization_member",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: t.varchar({ length: 32 }).notNull().default("Member"),
    status: t.varchar({ length: 32 }).notNull().default("Active"),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("organization_member_org_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_member_user_idx").on(table.userId),
    index("organization_member_org_idx").on(table.organizationId),
  ],
);

export const OrganizationSubscription = pgTable(
  "organization_subscription",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .unique()
      .references(() => Organization.id, { onDelete: "cascade" }),
    plan: t.varchar({ length: 32 }).notNull().default("Starter"),
    status: t.varchar({ length: 32 }).notNull().default("Trialing"),
    stripeCustomerId: t.text(),
    stripeSubscriptionId: t.text(),
    currentPeriodStart: t.timestamp(),
    currentPeriodEnd: t.timestamp(),
    cancelAtPeriodEnd: t.boolean().notNull().default(false),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("organization_subscription_org_idx").on(table.organizationId),
    index("organization_subscription_stripe_customer_idx").on(
      table.stripeCustomerId,
    ),
  ],
);

export const BillingInvoice = pgTable(
  "billing_invoice",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    stripeInvoiceId: t.text(),
    number: t.varchar({ length: 128 }),
    status: t.varchar({ length: 32 }).notNull().default("Draft"),
    currency: t.varchar({ length: 8 }).notNull().default("usd"),
    subtotalCents: t.integer().notNull().default(0),
    taxCents: t.integer().notNull().default(0),
    totalCents: t.integer().notNull().default(0),
    hostedInvoiceUrl: t.text(),
    periodStart: t.timestamp(),
    periodEnd: t.timestamp(),
    dueAt: t.timestamp(),
    paidAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("billing_invoice_org_idx").on(table.organizationId),
    uniqueIndex("billing_invoice_stripe_unique").on(table.stripeInvoiceId),
  ],
);

export const UsageLedger = pgTable(
  "usage_ledger",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentRunId: t.uuid(),
    sessionId: t.uuid(),
    metric: t.varchar({ length: 64 }).notNull(),
    quantity: t.integer().notNull().default(0),
    costCents: t.integer().notNull().default(0),
    metadata: t.jsonb().default({}),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("usage_ledger_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("usage_ledger_run_idx").on(table.agentRunId),
    index("usage_ledger_session_idx").on(table.sessionId),
  ],
);

export const IdempotencyKey = pgTable(
  "idempotency_key",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    userId: t.text().references(() => user.id, { onDelete: "set null" }),
    scope: t.varchar({ length: 64 }).notNull(),
    key: t.text().notNull(),
    requestHash: t.text().notNull(),
    response: t.jsonb(),
    status: t.varchar({ length: 32 }).notNull().default("Started"),
    expiresAt: t.timestamp().notNull(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("idempotency_key_org_scope_key_unique").on(
      table.organizationId,
      table.scope,
      table.key,
    ),
    index("idempotency_key_expires_idx").on(table.expiresAt),
  ],
);

export const OrganizationInvite = pgTable(
  "organization_invite",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    email: t.varchar({ length: 320 }).notNull(),
    role: t.varchar({ length: 32 }).notNull().default("Member"),
    token: t.text().notNull().unique(),
    status: t.varchar({ length: 32 }).notNull().default("Pending"),
    invitedByUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: t.timestamp().notNull(),
    acceptedAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("organization_invite_org_idx").on(table.organizationId),
    index("organization_invite_email_idx").on(table.email),
  ],
);

/** AI employees deployed in an organization */
export const Agent = pgTable("agent", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  organizationId: t
    .uuid()
    .notNull()
    .references(() => Organization.id, { onDelete: "cascade" }),
  type: t.varchar({ length: 64 }).notNull().default("Research"),
  name: t.varchar({ length: 256 }).notNull(),
  description: t.text().default(""),
  modelProvider: t.varchar({ length: 128 }).notNull(),
  modelName: t.varchar({ length: 128 }).notNull(),
  /**
   * Optional OpenAI-compatible base URL (e.g. TokenRouter, OpenRouter,
   * LiteLLM, Ollama). When set, the agent runtime will route AI SDK
   * calls through this endpoint using the agent's API key.
   */
  baseUrl: t.text(),
  /**
   * Per-agent API key, AES-256-GCM encrypted with a key derived from
   * AUTH_SECRET. Plaintext is never persisted; decryption happens at
   * execution time inside the worker.
   */
  apiKeyEncrypted: t.text(),
  /**
   * Cost per 1000 tokens (USD) attributed to this agent. Used when the
   * provider is a custom OpenAI-compatible endpoint whose pricing
   * AgentScope does not have a built-in rate for.
   */
  costPer1kTokens: t.real().notNull().default(0.03),
  status: t.varchar({ length: 32 }).notNull().default("Active"),
  systemPrompt: t.text().default(""),
  requiresApproval: t.boolean().notNull().default(false),
  toolMode: t.varchar({ length: 32 }).notNull().default("Restricted"),
  latestVersion: t.integer().notNull().default(1),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const AgentVersion = pgTable(
  "agent_version",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentId: t
      .uuid()
      .notNull()
      .references(() => Agent.id, { onDelete: "cascade" }),
    version: t.integer().notNull(),
    type: t.varchar({ length: 64 }).notNull(),
    modelProvider: t.varchar({ length: 128 }).notNull(),
    modelName: t.varchar({ length: 128 }).notNull(),
    baseUrl: t.text(),
    apiKeyEncrypted: t.text(),
    costPer1kTokens: t.real().notNull().default(0.03),
    systemPrompt: t.text().default(""),
    toolMode: t.varchar({ length: 32 }).notNull().default("Restricted"),
    requiresApproval: t.boolean().notNull().default(false),
    changeSummary: t.text().default("Initial version"),
    createdByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("agent_version_agent_version_unique").on(
      table.agentId,
      table.version,
    ),
    index("agent_version_org_idx").on(table.organizationId),
  ],
);

export const AgentToolDefinition = pgTable(
  "agent_tool_definition",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 128 }).notNull(),
    displayName: t.varchar({ length: 256 }).notNull(),
    scope: t.varchar({ length: 64 }).notNull().default("Custom"),
    description: t.text().default(""),
    configSchema: t.jsonb().default({}),
    enabled: t.boolean().notNull().default(true),
    createdByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("agent_tool_definition_org_name_unique").on(
      table.organizationId,
      table.name,
    ),
    index("agent_tool_definition_scope_idx").on(table.scope),
  ],
);

export const AgentToolGrant = pgTable(
  "agent_tool_grant",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentId: t
      .uuid()
      .notNull()
      .references(() => Agent.id, { onDelete: "cascade" }),
    toolId: t
      .uuid()
      .notNull()
      .references(() => AgentToolDefinition.id, { onDelete: "cascade" }),
    config: t.jsonb().default({}),
    grantedByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("agent_tool_grant_agent_tool_unique").on(
      table.agentId,
      table.toolId,
    ),
    index("agent_tool_grant_org_idx").on(table.organizationId),
  ],
);

export const CreateAgentSchema = createInsertSchema(Agent, {
  name: z.string().max(256),
  description: z.string().max(1024),
  type: z.enum(AGENT_TYPES),
  modelProvider: z.string().max(128),
  modelName: z.string().max(128),
  baseUrl: z.string().url().max(2048).nullable().optional(),
  apiKeyEncrypted: z.string().max(4096).nullable().optional(),
  costPer1kTokens: z.number().min(0).max(1000).default(0.03),
  status: z.string().max(32),
  systemPrompt: z.string().max(10_000),
  requiresApproval: z.boolean(),
}).omit({
  id: true,
  latestVersion: true,
  createdAt: true,
  updatedAt: true,
});

/** Sessions represent a single agent task execution */
export const Session = pgTable("agent_session", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  agentId: t
    .uuid()
    .notNull()
    .references(() => Agent.id, { onDelete: "cascade" }),
  organizationId: t
    .uuid()
    .notNull()
    .references(() => Organization.id, { onDelete: "cascade" }),
  status: t.varchar({ length: 32 }).notNull().default("Running"),
  input: t.text().default(""),
  output: t.text().default(""),
  totalTokens: t.integer().default(0),
  totalCost: t.real().default(0),
  toolCalls: t.integer().default(0),
  startedAt: t.timestamp().defaultNow().notNull(),
  endedAt: t.timestamp(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const AgentRun = pgTable(
  "agent_run",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentId: t
      .uuid()
      .notNull()
      .references(() => Agent.id, { onDelete: "cascade" }),
    agentVersionId: t.uuid().references(() => AgentVersion.id, {
      onDelete: "set null",
    }),
    requestedByUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    idempotencyKeyId: t.uuid().references(() => IdempotencyKey.id, {
      onDelete: "set null",
    }),
    sessionId: t.uuid(),
    status: t.varchar({ length: 32 }).notNull().default("Queued"),
    input: t.text().notNull(),
    output: t.text(),
    error: t.text(),
    attempts: t.integer().notNull().default(0),
    maxAttempts: t.integer().notNull().default(3),
    lockedAt: t.timestamp(),
    lockedBy: t.varchar({ length: 128 }),
    runAfter: t.timestamp().defaultNow().notNull(),
    startedAt: t.timestamp(),
    approvedAt: t.timestamp(),
    rejectedAt: t.timestamp(),
    completedAt: t.timestamp(),
    cancelledAt: t.timestamp(),
    deadLetteredAt: t.timestamp(),
    totalTokens: t.integer().notNull().default(0),
    totalCost: t.real().notNull().default(0),
    toolCalls: t.integer().notNull().default(0),
    investigation: t.jsonb(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("agent_run_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("agent_run_status_run_after_idx").on(table.status, table.runAfter),
    index("agent_run_session_idx").on(table.sessionId),
    index("agent_run_idempotency_idx").on(table.idempotencyKeyId),
  ],
);

export const AgentRunApproval = pgTable(
  "agent_run_approval",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentRunId: t
      .uuid()
      .notNull()
      .unique()
      .references(() => AgentRun.id, { onDelete: "cascade" }),
    requestedByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    decidedByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    status: t.varchar({ length: 32 }).notNull().default("Pending"),
    reason: t.text(),
    decisionNote: t.text(),
    expiresAt: t.timestamp(),
    decidedAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("agent_run_approval_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("agent_run_approval_run_idx").on(table.agentRunId),
  ],
);

export const AgentRunDeadLetter = pgTable(
  "agent_run_dead_letter",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentRunId: t
      .uuid()
      .notNull()
      .unique()
      .references(() => AgentRun.id, { onDelete: "cascade" }),
    failureClass: t.varchar({ length: 128 }).notNull(),
    reason: t.text().notNull(),
    payload: t.jsonb().default({}),
    retryable: t.boolean().notNull().default(false),
    resolvedAt: t.timestamp(),
    resolvedByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("agent_run_dead_letter_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const AgentEvaluation = pgTable(
  "agent_evaluation",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentId: t
      .uuid()
      .notNull()
      .references(() => Agent.id, { onDelete: "cascade" }),
    agentVersionId: t.uuid().references(() => AgentVersion.id, {
      onDelete: "set null",
    }),
    name: t.varchar({ length: 256 }).notNull(),
    prompt: t.text().notNull(),
    expectedSignals: t.jsonb().default([]),
    passThreshold: t.real().notNull().default(0.8),
    enabled: t.boolean().notNull().default(true),
    createdByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("agent_evaluation_org_agent_idx").on(
      table.organizationId,
      table.agentId,
    ),
  ],
);

export const AgentEvaluationRun = pgTable(
  "agent_evaluation_run",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    evaluationId: t
      .uuid()
      .notNull()
      .references(() => AgentEvaluation.id, { onDelete: "cascade" }),
    agentRunId: t.uuid().references(() => AgentRun.id, {
      onDelete: "set null",
    }),
    status: t.varchar({ length: 32 }).notNull().default("Queued"),
    score: t.real(),
    findings: t.jsonb().default([]),
    error: t.text(),
    startedAt: t.timestamp(),
    completedAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("agent_evaluation_run_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("agent_evaluation_run_eval_idx").on(table.evaluationId),
  ],
);

export const AuditLog = pgTable(
  "audit_log",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    actorUserId: t.text().references(() => user.id, { onDelete: "set null" }),
    action: t.varchar({ length: 128 }).notNull(),
    resourceType: t.varchar({ length: 64 }).notNull(),
    resourceId: t.text(),
    payload: t.jsonb().default({}),
    sequence: t.integer().notNull().default(0),
    payloadHash: t.text().notNull().default(""),
    previousHash: t.text(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("audit_log_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_log_action_idx").on(table.action),
    uniqueIndex("audit_log_org_sequence_unique").on(
      table.organizationId,
      table.sequence,
    ),
  ],
);

export const CompliancePolicy = pgTable(
  "compliance_policy",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .unique()
      .references(() => Organization.id, { onDelete: "cascade" }),
    retentionDays: t.integer().notNull().default(365),
    requireSplunkEvidence: t.boolean().notNull().default(true),
    redactSensitivePayloads: t.boolean().notNull().default(true),
    allowAuditExports: t.boolean().notNull().default(true),
    immutableAudit: t.boolean().notNull().default(true),
    enforceRetention: t.boolean().notNull().default(true),
    exportRequiresApproval: t.boolean().notNull().default(false),
    piiRedactionMode: t.varchar({ length: 32 }).notNull().default("Basic"),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [index("compliance_policy_org_idx").on(table.organizationId)],
);

export const ComplianceExport = pgTable(
  "compliance_export",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    requestedByUserId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exportType: t.varchar({ length: 64 }).notNull(),
    fileFormat: t.varchar({ length: 16 }).notNull().default("csv"),
    status: t.varchar({ length: 32 }).notNull().default("Completed"),
    filters: t.jsonb().default({}),
    content: t.text().notNull(),
    approvedByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("compliance_export_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const ComplianceLegalHold = pgTable(
  "compliance_legal_hold",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 256 }).notNull(),
    scope: t.jsonb().default({}),
    reason: t.text().notNull(),
    active: t.boolean().notNull().default(true),
    createdByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    releasedByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    releasedAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("compliance_legal_hold_org_active_idx").on(
      table.organizationId,
      table.active,
    ),
  ],
);

export const ComplianceEvidence = pgTable(
  "compliance_evidence",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    resourceType: t.varchar({ length: 64 }).notNull(),
    resourceId: t.text().notNull(),
    evidenceType: t.varchar({ length: 64 }).notNull(),
    evidenceUri: t.text(),
    payloadHash: t.text().notNull(),
    payload: t.jsonb().default({}),
    verifiedAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("compliance_evidence_resource_idx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
    ),
  ],
);

export const ComplianceRetentionJob = pgTable(
  "compliance_retention_job",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    status: t.varchar({ length: 32 }).notNull().default("Queued"),
    retentionDays: t.integer().notNull(),
    deletedEvents: t.integer().notNull().default(0),
    deletedSessions: t.integer().notNull().default(0),
    skippedByLegalHold: t.integer().notNull().default(0),
    error: t.text(),
    startedAt: t.timestamp(),
    completedAt: t.timestamp(),
    requestedByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("compliance_retention_job_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const SecurityPolicy = pgTable(
  "security_policy",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .unique()
      .references(() => Organization.id, { onDelete: "cascade" }),
    apiKeysEnabled: t.boolean().notNull().default(true),
    ssoRequired: t.boolean().notNull().default(false),
    scimRequired: t.boolean().notNull().default(false),
    defaultRateLimitPerMinute: t.integer().notNull().default(120),
    allowedEmailDomains: t.jsonb().default([]),
    sessionTtlMinutes: t.integer().notNull().default(720),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [index("security_policy_org_idx").on(table.organizationId)],
);

export const ApiKey = pgTable(
  "api_key",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 256 }).notNull(),
    keyHash: t.text().notNull(),
    prefix: t.varchar({ length: 16 }).notNull(),
    scopes: t.jsonb().default([]),
    status: t.varchar({ length: 32 }).notNull().default("Active"),
    createdByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    lastUsedAt: t.timestamp(),
    expiresAt: t.timestamp(),
    revokedAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("api_key_hash_unique").on(table.keyHash),
    index("api_key_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const RateLimitBucket = pgTable(
  "rate_limit_bucket",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    subject: t.varchar({ length: 256 }).notNull(),
    route: t.varchar({ length: 256 }).notNull(),
    windowStart: t.timestamp().notNull(),
    count: t.integer().notNull().default(0),
    limit: t.integer().notNull(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("rate_limit_bucket_unique").on(
      table.organizationId,
      table.subject,
      table.route,
      table.windowStart,
    ),
  ],
);

export const IdentityProvider = pgTable(
  "identity_provider",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    type: t.varchar({ length: 32 }).notNull(),
    name: t.varchar({ length: 256 }).notNull(),
    issuer: t.text().notNull(),
    ssoUrl: t.text(),
    certificate: t.text(),
    clientId: t.text(),
    metadata: t.jsonb().default({}),
    enabled: t.boolean().notNull().default(false),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("identity_provider_org_enabled_idx").on(
      table.organizationId,
      table.enabled,
    ),
  ],
);

export const ScimToken = pgTable(
  "scim_token",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    tokenHash: t.text().notNull(),
    prefix: t.varchar({ length: 16 }).notNull(),
    status: t.varchar({ length: 32 }).notNull().default("Active"),
    createdByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    lastUsedAt: t.timestamp(),
    expiresAt: t.timestamp(),
    revokedAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("scim_token_hash_unique").on(table.tokenHash),
    index("scim_token_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const AlertPolicy = pgTable(
  "alert_policy",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 256 }).notNull(),
    metric: t.varchar({ length: 64 }).notNull(),
    threshold: t.real().notNull(),
    comparison: t.varchar({ length: 16 }).notNull().default("gte"),
    channel: t.varchar({ length: 32 }).notNull().default("Email"),
    target: t.text().notNull(),
    enabled: t.boolean().notNull().default(true),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("alert_policy_org_idx").on(table.organizationId),
    index("alert_policy_metric_idx").on(table.metric),
  ],
);

export const AlertDelivery = pgTable(
  "alert_delivery",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    alertPolicyId: t
      .uuid()
      .notNull()
      .references(() => AlertPolicy.id, { onDelete: "cascade" }),
    status: t.varchar({ length: 32 }).notNull(),
    message: t.text().notNull(),
    payload: t.jsonb().default({}),
    deliveredAt: t.timestamp(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("alert_delivery_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("alert_delivery_policy_idx").on(table.alertPolicyId),
  ],
);

export const CreateSessionSchema = createInsertSchema(Session, {
  agentId: z.string(),
  organizationId: z.string(),
  status: z.string().max(32),
  input: z.string().max(4096),
}).omit({
  id: true,
  output: true,
  totalTokens: true,
  totalCost: true,
  toolCalls: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
});

/** Events: the spine of the platform. Every agent action becomes an event. */
export const Event = pgTable("event", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  sessionId: t
    .uuid()
    .notNull()
    .references(() => Session.id, { onDelete: "cascade" }),
  eventType: t.varchar({ length: 64 }).notNull(),
  payload: t.jsonb().default({}),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const TelemetryOutbox = pgTable(
  "telemetry_outbox",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    eventId: t.uuid().references(() => Event.id, { onDelete: "cascade" }),
    sessionId: t.uuid().notNull(),
    eventType: t.varchar({ length: 64 }).notNull(),
    destination: t.varchar({ length: 64 }).notNull().default("SplunkHEC"),
    payload: t.jsonb().default({}),
    status: t.varchar({ length: 32 }).notNull().default("Pending"),
    attempts: t.integer().notNull().default(0),
    maxAttempts: t.integer().notNull().default(10),
    lockedAt: t.timestamp(),
    lockedBy: t.varchar({ length: 128 }),
    runAfter: t.timestamp().defaultNow().notNull(),
    deliveredAt: t.timestamp(),
    lastError: t.text(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("telemetry_outbox_status_run_after_idx").on(
      table.status,
      table.runAfter,
    ),
    index("telemetry_outbox_session_idx").on(table.sessionId),
  ],
);

export const CreateEventSchema = createInsertSchema(Event, {
  sessionId: z.string(),
  eventType: z.string().max(64),
  payload: z.record(z.string(), z.unknown()),
}).omit({
  id: true,
  createdAt: true,
});

/** Cost tracking per session */
export const Cost = pgTable("cost", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  sessionId: t
    .uuid()
    .notNull()
    .references(() => Session.id, { onDelete: "cascade" }),
  provider: t.varchar({ length: 128 }).notNull(),
  modelName: t.varchar({ length: 128 }).notNull(),
  tokensIn: t.integer().default(0),
  tokensOut: t.integer().default(0),
  cost: t.real().default(0),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const AnalyticsSnapshot = pgTable(
  "analytics_snapshot",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    snapshotType: t.varchar({ length: 64 }).notNull(),
    windowStart: t.timestamp().notNull(),
    windowEnd: t.timestamp().notNull(),
    metrics: t.jsonb().default({}),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("analytics_snapshot_unique").on(
      table.organizationId,
      table.snapshotType,
      table.windowStart,
      table.windowEnd,
    ),
    index("analytics_snapshot_org_type_idx").on(
      table.organizationId,
      table.snapshotType,
    ),
  ],
);

export const OperationalInsight = pgTable(
  "operational_insight",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    insightType: t.varchar({ length: 64 }).notNull(),
    severity: t.varchar({ length: 32 }).notNull().default("info"),
    title: t.varchar({ length: 256 }).notNull(),
    description: t.text().notNull(),
    evidence: t.jsonb().default({}),
    status: t.varchar({ length: 32 }).notNull().default("Open"),
    createdAt: t.timestamp().defaultNow().notNull(),
    resolvedAt: t.timestamp(),
  }),
  (table) => [
    index("operational_insight_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("operational_insight_severity_idx").on(table.severity),
  ],
);

export const CreateOrganizationSchema = createInsertSchema(Organization, {
  name: z.string().min(2).max(256),
  slug: z.string().min(2).max(128),
}).omit({
  id: true,
  plan: true,
  createdAt: true,
  updatedAt: true,
});

export const CreateOrganizationInviteSchema = createInsertSchema(
  OrganizationInvite,
  {
    email: z.email().max(320),
    role: z.enum(ORGANIZATION_ROLES),
  },
).pick({
  email: true,
  role: true,
});

export const CreateAgentRunSchema = createInsertSchema(AgentRun, {
  agentId: z.string(),
  input: z.string().min(1).max(4096),
}).pick({
  agentId: true,
  input: true,
});

export const CreateAlertPolicySchema = createInsertSchema(AlertPolicy, {
  name: z.string().min(2).max(256),
  metric: z.enum(ALERT_METRICS),
  threshold: z.number(),
  comparison: z.enum(["gt", "gte", "lt", "lte"]),
  channel: z.enum(ALERT_CHANNELS),
  target: z.string().min(3),
}).pick({
  name: true,
  metric: true,
  threshold: true,
  comparison: true,
  channel: true,
  target: true,
});

export const CreateAgentToolDefinitionSchema = createInsertSchema(
  AgentToolDefinition,
  {
    name: z.string().min(2).max(128),
    displayName: z.string().min(2).max(256),
    scope: z.enum(AGENT_TOOL_SCOPES),
    description: z.string().max(2000),
  },
).pick({
  name: true,
  displayName: true,
  scope: true,
  description: true,
  configSchema: true,
  enabled: true,
});

export const CreateAgentEvaluationSchema = createInsertSchema(
  AgentEvaluation,
  {
    name: z.string().min(2).max(256),
    prompt: z.string().min(1).max(10_000),
    passThreshold: z.number().min(0).max(1),
  },
).pick({
  agentId: true,
  agentVersionId: true,
  name: true,
  prompt: true,
  expectedSignals: true,
  passThreshold: true,
  enabled: true,
});

export const CreateComplianceLegalHoldSchema = createInsertSchema(
  ComplianceLegalHold,
  {
    name: z.string().min(2).max(256),
    reason: z.string().min(2).max(4000),
  },
).pick({
  name: true,
  scope: true,
  reason: true,
  active: true,
});

export const CreateComplianceRetentionJobSchema = createInsertSchema(
  ComplianceRetentionJob,
  {
    retentionDays: z.number().int().min(30).max(3650),
  },
).pick({
  retentionDays: true,
});

export const CreateApiKeySchema = createInsertSchema(ApiKey, {
  name: z.string().min(2).max(256),
  status: z.enum(API_KEY_STATUSES),
}).pick({
  name: true,
  scopes: true,
  expiresAt: true,
});

export const UpsertSecurityPolicySchema = createInsertSchema(SecurityPolicy, {
  defaultRateLimitPerMinute: z.number().int().min(10).max(10_000),
  sessionTtlMinutes: z.number().int().min(15).max(43_200),
}).pick({
  apiKeysEnabled: true,
  ssoRequired: true,
  scimRequired: true,
  defaultRateLimitPerMinute: true,
  allowedEmailDomains: true,
  sessionTtlMinutes: true,
});

export const CreateIdentityProviderSchema = createInsertSchema(
  IdentityProvider,
  {
    type: z.enum(IDENTITY_PROVIDER_TYPES),
    name: z.string().min(2).max(256),
    issuer: z.string().min(2),
  },
).pick({
  type: true,
  name: true,
  issuer: true,
  ssoUrl: true,
  certificate: true,
  clientId: true,
  metadata: true,
  enabled: true,
});

// ----- Per-agent cost budgets -------------------------------------------

export const AgentCostBudget = pgTable(
  "agent_cost_budget",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentId: t
      .uuid()
      .notNull()
      .references(() => Agent.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 256 }).notNull(),
    period: t.varchar({ length: 16 }).notNull().default("Monthly"),
    maxCostCents: t.integer().notNull().default(0),
    maxTokens: t.integer().notNull().default(0),
    enforceHardCap: t.boolean().notNull().default(false),
    enabled: t.boolean().notNull().default(true),
    windowStart: t.timestamp().notNull().defaultNow(),
    createdByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("agent_cost_budget_org_idx").on(table.organizationId),
    index("agent_cost_budget_agent_idx").on(table.agentId),
    uniqueIndex("agent_cost_budget_agent_period_unique").on(
      table.agentId,
      table.period,
    ),
  ],
);

// ----- Scheduled agent runs --------------------------------------------

export const AgentSchedule = pgTable(
  "agent_schedule",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    agentId: t
      .uuid()
      .notNull()
      .references(() => Agent.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 256 }).notNull(),
    frequency: t.varchar({ length: 16 }).notNull().default("Daily"),
    cronExpression: t.varchar({ length: 128 }),
    inputPrompt: t.text().notNull().default(""),
    enabled: t.boolean().notNull().default(true),
    nextRunAt: t.timestamp().notNull().defaultNow(),
    lastRunAt: t.timestamp(),
    createdByUserId: t.text().references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("agent_schedule_org_idx").on(table.organizationId),
    index("agent_schedule_next_run_idx").on(
      table.enabled,
      table.nextRunAt,
    ),
  ],
);

export const AgentScheduleRun = pgTable(
  "agent_schedule_run",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    scheduleId: t
      .uuid()
      .notNull()
      .references(() => AgentSchedule.id, { onDelete: "cascade" }),
    agentRunId: t.uuid().references(() => AgentRun.id, {
      onDelete: "set null",
    }),
    scheduledFor: t.timestamp().notNull(),
    triggeredAt: t.timestamp().defaultNow().notNull(),
    status: t.varchar({ length: 32 }).notNull().default("Queued"),
    error: t.text(),
  }),
  (table) => [
    index("agent_schedule_run_org_idx").on(table.organizationId),
    index("agent_schedule_run_schedule_idx").on(table.scheduleId),
  ],
);

// ----- Real-time event stream (for SSE) --------------------------------

export const StreamEvent = pgTable(
  "stream_event",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    organizationId: t
      .uuid()
      .notNull()
      .references(() => Organization.id, { onDelete: "cascade" }),
    eventType: t.varchar({ length: 64 }).notNull(),
    payload: t.jsonb().default({}),
    resourceType: t.varchar({ length: 64 }),
    resourceId: t.text(),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("stream_event_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("stream_event_resource_idx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
    ),
  ],
);

// ----- Webhook event dedup ----------------------------------------------
//
// Stripe (and any future provider) webhooks can be delivered more than
// once for the same logical event. To prevent re-applying side effects
// (double-charging an invoice, double-creating a subscription) we record
// every successfully processed event id in this table and short-circuit
// duplicates. The unique index on `event_id` is the dedup boundary; the
// route handler attempts the insert first and treats a unique-violation
// as "already processed" (a 200 to Stripe, no side effects). The
// `source` column lets us support multiple providers without
// cross-contaminating event ids.
export const ProcessedWebhookEvent = pgTable(
  "processed_webhook_event",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    source: t.varchar({ length: 32 }).notNull(),
    eventId: t.varchar({ length: 128 }).notNull(),
    eventType: t.varchar({ length: 64 }).notNull(),
    processedAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("processed_webhook_event_source_event_unique").on(
      table.source,
      table.eventId,
    ),
    index("processed_webhook_event_processed_at_idx").on(table.processedAt),
  ],
);

export const CreateAgentCostBudgetSchema = createInsertSchema(
  AgentCostBudget,
  {
    name: z.string().min(2).max(256),
    period: z.enum(AGENT_COST_BUDGET_PERIODS),
    maxCostCents: z.number().int().min(0).max(100_000_000),
    maxTokens: z.number().int().min(0).max(10_000_000_000),
  },
).pick({
  agentId: true,
  name: true,
  period: true,
  maxCostCents: true,
  maxTokens: true,
  enforceHardCap: true,
  enabled: true,
});

export const CreateAgentScheduleSchema = createInsertSchema(
  AgentSchedule,
  {
    name: z.string().min(2).max(256),
    frequency: z.enum(AGENT_SCHEDULE_FREQUENCIES),
    cronExpression: z.string().max(128).optional(),
    inputPrompt: z.string().min(1).max(4096),
  },
).pick({
  agentId: true,
  name: true,
  frequency: true,
  cronExpression: true,
  inputPrompt: true,
  enabled: true,
});

export * from "./auth-schema";
