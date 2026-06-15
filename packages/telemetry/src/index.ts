import { eq } from "@agentscope/db";
import { db } from "@agentscope/db/client";
import { CompliancePolicy, Cost, Event, Session } from "@agentscope/db/schema";

import type { EventType } from "./types";
import { enqueueSplunkOutbox } from "./outbox";

/**
 * Telemetry package: the spine of the AgentScope platform.
 *
 * Every agent action flows through this package.
 * Events are dual-written to PostgreSQL (for app queries) and
 * forwarded to Splunk HEC (for Splunk-powered analytics).
 */

interface TrackEventInput {
  sessionId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
}

export async function trackEvent(input: TrackEventInput): Promise<void> {
  const payload = await redactPayloadForSession(input.sessionId, input.payload);
  const [event] = await db
    .insert(Event)
    .values({
      sessionId: input.sessionId,
      eventType: input.eventType,
      payload,
    })
    .returning();

  if (!event) {
    throw new Error(`Failed to persist telemetry event ${input.eventType}.`);
  }

  await enqueueSplunkOutbox({
    eventId: event.id,
    sessionId: input.sessionId,
    eventType: input.eventType,
    payload,
  });
}

export async function startSession(input: {
  sessionId: string;
  agentId: string;
  agentName: string;
  organizationId: string;
  input: string;
  modelProvider: string;
  modelName: string;
}): Promise<void> {
  if (!input.organizationId) {
    throw new Error("organizationId is required to start an agent session.");
  }

  await db
    .insert(Session)
    .values({
      id: input.sessionId,
      agentId: input.agentId,
      organizationId: input.organizationId,
      status: "Running",
      input: input.input,
      totalTokens: 0,
      totalCost: 0,
      toolCalls: 0,
    })
    .onConflictDoNothing();

  await trackEvent({
    sessionId: input.sessionId,
    eventType: "SessionStarted",
    payload: {
      agentId: input.agentId,
      agentName: input.agentName,
      input: input.input,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
    },
  });
}

export async function finishSession(input: {
  sessionId: string;
  output?: string;
  duration: number;
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
}): Promise<void> {
  await db
    .update(Session)
    .set({
      status: "Completed",
      output: input.output ?? "",
      totalTokens: input.totalTokens,
      totalCost: input.totalCost,
      toolCalls: input.toolCalls,
      endedAt: new Date(),
    })
    .where(eq(Session.id, input.sessionId));

  await trackEvent({
    sessionId: input.sessionId,
    eventType: "SessionCompleted",
    payload: {
      output: input.output,
      duration: input.duration,
      totalTokens: input.totalTokens,
      totalCost: input.totalCost,
      toolCalls: input.toolCalls,
    },
  });
}

export async function recordCost(input: {
  sessionId: string;
  agentName?: string;
  provider: string;
  modelName: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}): Promise<void> {
  await db.insert(Cost).values({
    sessionId: input.sessionId,
    provider: input.provider,
    modelName: input.modelName,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    cost: input.cost,
  });

  await trackEvent({
    sessionId: input.sessionId,
    eventType: "CostRecorded",
    payload: {
      agentName: input.agentName,
      provider: input.provider,
      modelName: input.modelName,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      cost: input.cost,
    },
  });
}

export async function recordFailure(input: {
  sessionId: string;
  error: string;
  duration: number;
}): Promise<void> {
  await db
    .update(Session)
    .set({
      status: "Failed",
      output: input.error,
      endedAt: new Date(),
    })
    .where(eq(Session.id, input.sessionId));

  await trackEvent({
    sessionId: input.sessionId,
    eventType: "SessionFailed",
    payload: {
      error: input.error,
      duration: input.duration,
    },
  });
}

export async function trackToolCall(params: {
  sessionId: string;
  toolName: string;
  input: unknown;
}): Promise<void> {
  await trackEvent({
    sessionId: params.sessionId,
    eventType: "ToolCalled",
    payload: {
      toolName: params.toolName,
      input: params.input,
    },
  });
}

export async function trackToolReturn(input: {
  sessionId: string;
  toolName: string;
  output: unknown;
  duration: number;
}): Promise<void> {
  await trackEvent({
    sessionId: input.sessionId,
    eventType: "ToolReturned",
    payload: {
      toolName: input.toolName,
      output: input.output,
      duration: input.duration,
    },
  });
}

export async function trackModelInvocation(input: {
  sessionId: string;
  provider: string;
  model: string;
  tokens: number;
  tokensOut: number;
  duration: number;
  output?: string;
}): Promise<void> {
  await trackEvent({
    sessionId: input.sessionId,
    eventType: "ModelInvoked",
    payload: {
      provider: input.provider,
      model: input.model,
      tokens: input.tokens,
    },
  });

  await trackEvent({
    sessionId: input.sessionId,
    eventType: "ModelCompleted",
    payload: {
      provider: input.provider,
      model: input.model,
      output: input.output,
      tokensIn: input.tokens,
      tokensOut: input.tokensOut,
      duration: input.duration,
    },
  });
}

export * from "./types";
export {
  checkSplunkHecHealth,
  forwardToSplunk,
  isSplunkEnabled,
  setSplunkEnabled,
} from "./splunk";
export {
  enqueueSplunkOutbox,
  getTelemetryOutboxHealth,
  processTelemetryOutboxBatch,
  processTelemetryOutboxForSession,
  reapStaleTelemetryOutbox,
} from "./outbox";
export type { OutboxHealthSnapshot } from "./outbox";
export {
  getMcpStatus,
  initSplunkMcp,
  isMcpEnabled,
  mcpAgentEventCount,
  mcpCostByAgent,
  mcpHeartbeat,
  mcpSearch,
} from "./mcp";
export type { McpHeartbeatSample, SplunkMcpStatus } from "./mcp";
export {
  detectCostAnomalies,
  detectFailureAnomalies,
  detectHallucinationAnomalies,
  runAllAnomalyChecks,
  isAnomalyEnabled,
} from "./anomaly";
export type { AnomalyResult } from "./anomaly";
export { initOpenTelemetry, isOtelEnabled } from "./otel";
export {
  emitStreamEvent,
  getRecentStreamEvents,
  getStreamEventsAfter,
  publishStreamEvent,
  sseConnectionClosed,
  sseConnectionOpened,
} from "./stream";
export type { StreamEventType } from "./stream";

async function redactPayloadForSession(
  sessionId: string,
  payload: Record<string, unknown>,
) {
  const session = await db.query.Session.findFirst({
    where: eq(Session.id, sessionId),
    columns: { organizationId: true },
  });

  if (!session) return redactSensitivePayload(payload);

  const policy = await db.query.CompliancePolicy.findFirst({
    where: eq(CompliancePolicy.organizationId, session.organizationId),
  });

  if (policy?.redactSensitivePayloads === false) return payload;

  return redactSensitivePayload(payload);
}

function redactSensitivePayload(value: unknown): Record<string, unknown> {
  const redacted = redactValue(value);
  return typeof redacted === "object" && redacted !== null
    ? (redacted as Record<string, unknown>)
    : {};
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);

  if (typeof value === "string") {
    return value.replaceAll(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[redacted-email]",
    );
  }

  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactValue(nested),
    ]),
  );
}

function isSensitiveKey(key: string) {
  // The previous regex `/token|.../` over-matched: it caught LLM token
  // counts (`tokens`, `tokensIn`, `tokensOut`, `totalTokens`) and clobbered
  // them with `"[redacted]"`, breaking per-session cost attribution in the
  // dashboard. Now we only match concrete secret-shaped patterns:
  //   - bare `secret` / `password` / `authorization` / `credential`
  //   - `apiKey`, `apiKeyEncrypted`, `api_key` (any suffix)
  //   - OAuth-shaped `*token` names: `accessToken`, `refreshToken`,
  //     `idToken`, `bearerToken` — note the literal `-_?token` suffix
  //     so `tokens`, `tokensIn`, `tokensOut`, `totalTokens` do NOT match.
  return /\b(secret|password|credential|authorization)\b|api[-_]?key|(?:access|refresh|id|bearer)[-_]?token/i.test(
    key,
  );
}
