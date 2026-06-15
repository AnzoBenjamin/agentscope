CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" varchar(64) DEFAULT 'Research' NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text DEFAULT '',
	"model_provider" varchar(128) NOT NULL,
	"model_name" varchar(128) NOT NULL,
	"base_url" text,
	"api_key_encrypted" text,
	"cost_per1k_tokens" real DEFAULT 0.03 NOT NULL,
	"status" varchar(32) DEFAULT 'Active' NOT NULL,
	"system_prompt" text DEFAULT '',
	"requires_approval" boolean DEFAULT false NOT NULL,
	"tool_mode" varchar(32) DEFAULT 'Restricted' NOT NULL,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_cost_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"period" varchar(16) DEFAULT 'Monthly' NOT NULL,
	"max_cost_cents" integer DEFAULT 0 NOT NULL,
	"max_tokens" integer DEFAULT 0 NOT NULL,
	"enforce_hard_cap" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"window_start" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_evaluation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version_id" uuid,
	"name" varchar(256) NOT NULL,
	"prompt" text NOT NULL,
	"expected_signals" jsonb DEFAULT '[]'::jsonb,
	"pass_threshold" real DEFAULT 0.8 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_evaluation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"status" varchar(32) DEFAULT 'Queued' NOT NULL,
	"score" real,
	"findings" jsonb DEFAULT '[]'::jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version_id" uuid,
	"requested_by_user_id" text NOT NULL,
	"idempotency_key_id" uuid,
	"session_id" uuid,
	"status" varchar(32) DEFAULT 'Queued' NOT NULL,
	"input" text NOT NULL,
	"output" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp,
	"locked_by" varchar(128),
	"run_after" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"dead_lettered_at" timestamp,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"investigation" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_run_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"requested_by_user_id" text,
	"decided_by_user_id" text,
	"status" varchar(32) DEFAULT 'Pending' NOT NULL,
	"reason" text,
	"decision_note" text,
	"expires_at" timestamp,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "agent_run_approval_agentRunId_unique" UNIQUE("agent_run_id")
);
--> statement-breakpoint
CREATE TABLE "agent_run_dead_letter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"failure_class" varchar(128) NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"retryable" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_dead_letter_agentRunId_unique" UNIQUE("agent_run_id")
);
--> statement-breakpoint
CREATE TABLE "agent_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"frequency" varchar(16) DEFAULT 'Daily' NOT NULL,
	"cron_expression" varchar(128),
	"input_prompt" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp DEFAULT now() NOT NULL,
	"last_run_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_schedule_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"scheduled_for" timestamp NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(32) DEFAULT 'Queued' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "agent_tool_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"display_name" varchar(256) NOT NULL,
	"scope" varchar(64) DEFAULT 'Custom' NOT NULL,
	"description" text DEFAULT '',
	"config_schema" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_tool_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"granted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"model_provider" varchar(128) NOT NULL,
	"model_name" varchar(128) NOT NULL,
	"base_url" text,
	"api_key_encrypted" text,
	"cost_per1k_tokens" real DEFAULT 0.03 NOT NULL,
	"system_prompt" text DEFAULT '',
	"tool_mode" varchar(32) DEFAULT 'Restricted' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"change_summary" text DEFAULT 'Initial version',
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"alert_policy_id" uuid NOT NULL,
	"status" varchar(32) NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"metric" varchar(64) NOT NULL,
	"threshold" real NOT NULL,
	"comparison" varchar(16) DEFAULT 'gte' NOT NULL,
	"channel" varchar(32) DEFAULT 'Email' NOT NULL,
	"target" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"snapshot_type" varchar(64) NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(32) DEFAULT 'Active' NOT NULL,
	"created_by_user_id" text,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" varchar(128) NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"sequence" integer DEFAULT 0 NOT NULL,
	"payload_hash" text DEFAULT '' NOT NULL,
	"previous_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"stripe_invoice_id" text,
	"number" varchar(128),
	"status" varchar(32) DEFAULT 'Draft' NOT NULL,
	"currency" varchar(8) DEFAULT 'usd' NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"hosted_invoice_url" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"due_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"resource_id" text NOT NULL,
	"evidence_type" varchar(64) NOT NULL,
	"evidence_uri" text,
	"payload_hash" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"export_type" varchar(64) NOT NULL,
	"file_format" varchar(16) DEFAULT 'csv' NOT NULL,
	"status" varchar(32) DEFAULT 'Completed' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb,
	"content" text NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_legal_hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb,
	"reason" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"released_by_user_id" text,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "compliance_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"retention_days" integer DEFAULT 365 NOT NULL,
	"require_splunk_evidence" boolean DEFAULT true NOT NULL,
	"redact_sensitive_payloads" boolean DEFAULT true NOT NULL,
	"allow_audit_exports" boolean DEFAULT true NOT NULL,
	"immutable_audit" boolean DEFAULT true NOT NULL,
	"enforce_retention" boolean DEFAULT true NOT NULL,
	"export_requires_approval" boolean DEFAULT false NOT NULL,
	"pii_redaction_mode" varchar(32) DEFAULT 'Basic' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "compliance_policy_organizationId_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "compliance_retention_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'Queued' NOT NULL,
	"retention_days" integer NOT NULL,
	"deleted_events" integer DEFAULT 0 NOT NULL,
	"deleted_sessions" integer DEFAULT 0 NOT NULL,
	"skipped_by_legal_hold" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"requested_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"provider" varchar(128) NOT NULL,
	"model_name" varchar(128) NOT NULL,
	"tokens_in" integer DEFAULT 0,
	"tokens_out" integer DEFAULT 0,
	"cost" real DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text,
	"scope" varchar(64) NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"status" varchar(32) DEFAULT 'Started' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_provider" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"name" varchar(256) NOT NULL,
	"issuer" text NOT NULL,
	"sso_url" text,
	"certificate" text,
	"client_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operational_insight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"insight_type" varchar(64) NOT NULL,
	"severity" varchar(32) DEFAULT 'info' NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb,
	"status" varchar(32) DEFAULT 'Open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(256) NOT NULL,
	"slug" varchar(128) NOT NULL,
	"plan" varchar(64) DEFAULT 'Starter' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organization_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" varchar(32) DEFAULT 'Member' NOT NULL,
	"token" text NOT NULL,
	"status" varchar(32) DEFAULT 'Pending' NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "organization_invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "organization_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(32) DEFAULT 'Member' NOT NULL,
	"status" varchar(32) DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan" varchar(32) DEFAULT 'Starter' NOT NULL,
	"status" varchar(32) DEFAULT 'Trialing' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "organization_subscription_organizationId_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_bucket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject" varchar(256) NOT NULL,
	"route" varchar(256) NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"limit" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scim_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'Active' NOT NULL,
	"created_by_user_id" text,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"api_keys_enabled" boolean DEFAULT true NOT NULL,
	"sso_required" boolean DEFAULT false NOT NULL,
	"scim_required" boolean DEFAULT false NOT NULL,
	"default_rate_limit_per_minute" integer DEFAULT 120 NOT NULL,
	"allowed_email_domains" jsonb DEFAULT '[]'::jsonb,
	"session_ttl_minutes" integer DEFAULT 720 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "security_policy_organizationId_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "agent_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'Running' NOT NULL,
	"input" text DEFAULT '',
	"output" text DEFAULT '',
	"total_tokens" integer DEFAULT 0,
	"total_cost" real DEFAULT 0,
	"tool_calls" integer DEFAULT 0,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"resource_type" varchar(64),
	"resource_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"session_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"destination" varchar(64) DEFAULT 'SplunkHEC' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"status" varchar(32) DEFAULT 'Pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"locked_at" timestamp,
	"locked_by" varchar(128),
	"run_after" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"session_id" uuid,
	"metric" varchar(64) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cost_budget" ADD CONSTRAINT "agent_cost_budget_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cost_budget" ADD CONSTRAINT "agent_cost_budget_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cost_budget" ADD CONSTRAINT "agent_cost_budget_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation" ADD CONSTRAINT "agent_evaluation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation" ADD CONSTRAINT "agent_evaluation_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation" ADD CONSTRAINT "agent_evaluation_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation" ADD CONSTRAINT "agent_evaluation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation_run" ADD CONSTRAINT "agent_evaluation_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation_run" ADD CONSTRAINT "agent_evaluation_run_evaluation_id_agent_evaluation_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."agent_evaluation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluation_run" ADD CONSTRAINT "agent_evaluation_run_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_version_id_agent_version_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_idempotency_key_id_idempotency_key_id_fk" FOREIGN KEY ("idempotency_key_id") REFERENCES "public"."idempotency_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_approval" ADD CONSTRAINT "agent_run_approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_approval" ADD CONSTRAINT "agent_run_approval_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_approval" ADD CONSTRAINT "agent_run_approval_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_approval" ADD CONSTRAINT "agent_run_approval_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_dead_letter" ADD CONSTRAINT "agent_run_dead_letter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_dead_letter" ADD CONSTRAINT "agent_run_dead_letter_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_dead_letter" ADD CONSTRAINT "agent_run_dead_letter_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD CONSTRAINT "agent_schedule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD CONSTRAINT "agent_schedule_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule" ADD CONSTRAINT "agent_schedule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule_run" ADD CONSTRAINT "agent_schedule_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule_run" ADD CONSTRAINT "agent_schedule_run_schedule_id_agent_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."agent_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_schedule_run" ADD CONSTRAINT "agent_schedule_run_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_definition" ADD CONSTRAINT "agent_tool_definition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_definition" ADD CONSTRAINT "agent_tool_definition_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_grant" ADD CONSTRAINT "agent_tool_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_grant" ADD CONSTRAINT "agent_tool_grant_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_grant" ADD CONSTRAINT "agent_tool_grant_tool_id_agent_tool_definition_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."agent_tool_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_grant" ADD CONSTRAINT "agent_tool_grant_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_alert_policy_id_alert_policy_id_fk" FOREIGN KEY ("alert_policy_id") REFERENCES "public"."alert_policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_policy" ADD CONSTRAINT "alert_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshot" ADD CONSTRAINT "analytics_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoice" ADD CONSTRAINT "billing_invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_export" ADD CONSTRAINT "compliance_export_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_export" ADD CONSTRAINT "compliance_export_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_export" ADD CONSTRAINT "compliance_export_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_legal_hold" ADD CONSTRAINT "compliance_legal_hold_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_legal_hold" ADD CONSTRAINT "compliance_legal_hold_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_legal_hold" ADD CONSTRAINT "compliance_legal_hold_released_by_user_id_user_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_policy" ADD CONSTRAINT "compliance_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_retention_job" ADD CONSTRAINT "compliance_retention_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_retention_job" ADD CONSTRAINT "compliance_retention_job_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost" ADD CONSTRAINT "cost_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider" ADD CONSTRAINT "identity_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_insight" ADD CONSTRAINT "operational_insight_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invite" ADD CONSTRAINT "organization_invite_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invite" ADD CONSTRAINT "organization_invite_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscription" ADD CONSTRAINT "organization_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_bucket" ADD CONSTRAINT "rate_limit_bucket_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_token" ADD CONSTRAINT "scim_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_token" ADD CONSTRAINT "scim_token_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_policy" ADD CONSTRAINT "security_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_event" ADD CONSTRAINT "stream_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_outbox" ADD CONSTRAINT "telemetry_outbox_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_cost_budget_org_idx" ON "agent_cost_budget" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_cost_budget_agent_idx" ON "agent_cost_budget" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_cost_budget_agent_period_unique" ON "agent_cost_budget" USING btree ("agent_id","period");--> statement-breakpoint
CREATE INDEX "agent_evaluation_org_agent_idx" ON "agent_evaluation" USING btree ("organization_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_evaluation_run_org_created_idx" ON "agent_evaluation_run" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_evaluation_run_eval_idx" ON "agent_evaluation_run" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "agent_run_org_created_idx" ON "agent_run" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_status_run_after_idx" ON "agent_run" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "agent_run_session_idx" ON "agent_run" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_run_idempotency_idx" ON "agent_run" USING btree ("idempotency_key_id");--> statement-breakpoint
CREATE INDEX "agent_run_approval_org_status_idx" ON "agent_run_approval" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "agent_run_approval_run_idx" ON "agent_run_approval" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "agent_run_dead_letter_org_created_idx" ON "agent_run_dead_letter" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_schedule_org_idx" ON "agent_schedule" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_schedule_next_run_idx" ON "agent_schedule" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "agent_schedule_run_org_idx" ON "agent_schedule_run" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_schedule_run_schedule_idx" ON "agent_schedule_run" USING btree ("schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_definition_org_name_unique" ON "agent_tool_definition" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "agent_tool_definition_scope_idx" ON "agent_tool_definition" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_grant_agent_tool_unique" ON "agent_tool_grant" USING btree ("agent_id","tool_id");--> statement-breakpoint
CREATE INDEX "agent_tool_grant_org_idx" ON "agent_tool_grant" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_version_agent_version_unique" ON "agent_version" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "agent_version_org_idx" ON "agent_version" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "alert_delivery_org_created_idx" ON "alert_delivery" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_delivery_policy_idx" ON "alert_delivery" USING btree ("alert_policy_id");--> statement-breakpoint
CREATE INDEX "alert_policy_org_idx" ON "alert_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "alert_policy_metric_idx" ON "alert_policy" USING btree ("metric");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_snapshot_unique" ON "analytics_snapshot" USING btree ("organization_id","snapshot_type","window_start","window_end");--> statement-breakpoint
CREATE INDEX "analytics_snapshot_org_type_idx" ON "analytics_snapshot" USING btree ("organization_id","snapshot_type");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_unique" ON "api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_key_org_status_idx" ON "api_key" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_org_sequence_unique" ON "audit_log" USING btree ("organization_id","sequence");--> statement-breakpoint
CREATE INDEX "billing_invoice_org_idx" ON "billing_invoice" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_invoice_stripe_unique" ON "billing_invoice" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "compliance_evidence_resource_idx" ON "compliance_evidence" USING btree ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "compliance_export_org_created_idx" ON "compliance_export" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "compliance_legal_hold_org_active_idx" ON "compliance_legal_hold" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "compliance_policy_org_idx" ON "compliance_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "compliance_retention_job_org_created_idx" ON "compliance_retention_job" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_org_scope_key_unique" ON "idempotency_key" USING btree ("organization_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_key_expires_idx" ON "idempotency_key" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "identity_provider_org_enabled_idx" ON "identity_provider" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE INDEX "operational_insight_org_status_idx" ON "operational_insight" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "operational_insight_severity_idx" ON "operational_insight" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "organization_invite_org_idx" ON "organization_invite" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_invite_email_idx" ON "organization_invite" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_member_org_user_unique" ON "organization_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_member_user_idx" ON "organization_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_member_org_idx" ON "organization_member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_subscription_org_idx" ON "organization_subscription" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_subscription_stripe_customer_idx" ON "organization_subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_bucket_unique" ON "rate_limit_bucket" USING btree ("organization_id","subject","route","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_token_hash_unique" ON "scim_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "scim_token_org_status_idx" ON "scim_token" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "security_policy_org_idx" ON "security_policy" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stream_event_org_created_idx" ON "stream_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "stream_event_resource_idx" ON "stream_event" USING btree ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "telemetry_outbox_status_run_after_idx" ON "telemetry_outbox" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "telemetry_outbox_session_idx" ON "telemetry_outbox" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_org_created_idx" ON "usage_ledger" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_ledger_run_idx" ON "usage_ledger" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_session_idx" ON "usage_ledger" USING btree ("session_id");