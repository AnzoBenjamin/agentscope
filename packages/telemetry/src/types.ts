import { z } from "zod/v4";

/**
 * Event types that power the AgentScope platform.
 * Every agent action becomes an event. This is the spine.
 */
export const EventType = z.enum([
  "SessionStarted",
  "PromptReceived",
  "ContextLoaded",
  "ToolCalled",
  "ToolReturned",
  "ModelInvoked",
  "ModelCompleted",
  "SessionCompleted",
  "SessionFailed",
  "CostRecorded",
  "SplunkMcpSearch",
  "SplunkInvestigationCompleted",
  "SplunkInvestigationFailed",
]);

export type EventType = z.infer<typeof EventType>;

export const SessionStatus = z.enum([
  "Running",
  "Completed",
  "Failed",
  "Cancelled",
]);

export type SessionStatus = z.infer<typeof SessionStatus>;

export const AgentStatus = z.enum(["Active", "Paused", "Archived"]);

export type AgentStatus = z.infer<typeof AgentStatus>;

/** Payload schemas for each event type */
export const SessionStartedPayload = z.object({
  agentId: z.string(),
  agentName: z.string(),
  input: z.string(),
  modelProvider: z.string(),
  modelName: z.string(),
});

export const PromptReceivedPayload = z.object({
  prompt: z.string(),
  tokens: z.number().optional(),
});

export const ContextLoadedPayload = z.object({
  source: z.string(),
  size: z.number(),
});

export const ToolCalledPayload = z.object({
  toolName: z.string(),
  input: z.unknown(),
});

export const ToolReturnedPayload = z.object({
  toolName: z.string(),
  output: z.unknown(),
  duration: z.number(),
});

export const ModelInvokedPayload = z.object({
  provider: z.string(),
  model: z.string(),
  tokens: z.number().optional(),
});

export const ModelCompletedPayload = z.object({
  provider: z.string(),
  model: z.string(),
  output: z.string().optional(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  duration: z.number(),
});

export const SessionCompletedPayload = z.object({
  output: z.string().optional(),
  duration: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
});

export const SessionFailedPayload = z.object({
  error: z.string(),
  duration: z.number(),
});

export const CostRecordedPayload = z.object({
  provider: z.string(),
  modelName: z.string(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  cost: z.number(),
});

export const SplunkMcpSearchPayload = z.object({
  query: z.string(),
  connected: z.boolean(),
});

export const SplunkInvestigationCompletedPayload = z.object({
  status: z.string(),
  summary: z.string(),
  riskLevel: z.string(),
  usedSplunkMcp: z.boolean(),
});

export const SplunkInvestigationFailedPayload = z.object({
  query: z.string(),
  reason: z.string(),
});

/** Aggregate event payload type */
export const EventPayloadSchema = z.union([
  SessionStartedPayload,
  PromptReceivedPayload,
  ContextLoadedPayload,
  ToolCalledPayload,
  ToolReturnedPayload,
  ModelInvokedPayload,
  ModelCompletedPayload,
  SessionCompletedPayload,
  SessionFailedPayload,
  CostRecordedPayload,
  SplunkMcpSearchPayload,
  SplunkInvestigationCompletedPayload,
  SplunkInvestigationFailedPayload,
]);

export type EventPayload = z.infer<typeof EventPayloadSchema>;
