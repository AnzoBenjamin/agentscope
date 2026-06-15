import { and, asc, desc, eq, gt, gte } from "@agentscope/db";
import { db as defaultDb } from "@agentscope/db/client";
import { StreamEvent } from "@agentscope/db/schema";
import { sseConnections } from "@agentscope/observability";

type AgentScopeDb = typeof defaultDb;

// Drizzle transaction handle. Accept either the root db or a transaction
// so callers that wrap work in `db.transaction(...)` can pass `tx`.
export type AgentScopeDbOrTx =
  | AgentScopeDb
  | Parameters<Parameters<AgentScopeDb["transaction"]>[0]>[0];

// Canonical stream event types. `PublishInput.eventType` widens to
// `string` at the call site so callers may also emit non-canonical
// domain-specific event types (e.g. `resource.created`) that the
// public API doesn't need to enumerate.
export type StreamEventType =
  | "agent_run.created"
  | "agent_run.started"
  | "agent_run.completed"
  | "agent_run.failed"
  | "agent_run.cancelled"
  | "agent_run.dead_lettered"
  | "agent_session.started"
  | "agent_session.completed"
  | "agent_session.failed"
  | "telemetry.event"
  | "alert.delivered"
  | "cost.recorded"
  | "splunk.investigation.completed";

interface PublishInput {
  organizationId: string;
  // `string` (not `StreamEventType`) so callers may emit non-canonical
  // domain-specific event types (e.g. `resource.created`) that the
  // public API doesn't need to enumerate. The canonical types are
  // documented on `StreamEventType` for autocomplete at the call site.
  eventType: string;
  payload: Record<string, unknown>;
  resourceType?: string;
  resourceId?: string;
}

/**
 * Publish a stream event for an organization.
 * Persists to Postgres and increments SSE connection gauge for visibility.
 */
export async function publishStreamEvent(
  input: PublishInput,
  options: { db?: AgentScopeDbOrTx } = {},
): Promise<void> {
  const db = options.db ?? defaultDb;
  await db.insert(StreamEvent).values({
    organizationId: input.organizationId,
    eventType: input.eventType,
    payload: input.payload,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
  });
}

/**
 * Get recent stream events for an organization, optionally filtered by resource.
 * Used by SSE clients to seed the initial timeline on connection.
 */
export async function getRecentStreamEvents(
  organizationId: string,
  options: {
    db?: AgentScopeDbOrTx;
    limit?: number;
    sinceMs?: number;
    afterCreatedAt?: Date;
    resourceType?: string;
    resourceId?: string;
  } = {},
) {
  const db = options.db ?? defaultDb;
  const limit = options.limit ?? 50;
  const filters = [eq(StreamEvent.organizationId, organizationId)];
  if (options.afterCreatedAt) {
    filters.push(gt(StreamEvent.createdAt, options.afterCreatedAt));
  }
  if (options.sinceMs) {
    filters.push(gte(StreamEvent.createdAt, new Date(Date.now() - options.sinceMs)));
  }
  if (options.resourceType) {
    filters.push(eq(StreamEvent.resourceType, options.resourceType));
  }
  if (options.resourceId) {
    filters.push(eq(StreamEvent.resourceId, options.resourceId));
  }
  // Newest first so the client can walk through history; poll-loop callers
  // pass `afterCreatedAt` so they only get events newer than the last seen one.
  return db.query.StreamEvent.findMany({
    where: and(...filters),
    orderBy: desc(StreamEvent.createdAt),
    limit,
  });
}

/**
 * Fetch events newer than `afterCreatedAt` in chronological (oldest-first) order.
 * Used by the SSE poll loop to deliver a strictly-forward, gap-free stream.
 *
 * The cursor is on `createdAt` (not `id`) because `StreamEvent.id` is a
 * random UUIDv4 and lexicographic UUID order is unrelated to insert order.
 * Filtering on `createdAt` plus ordering ascending guarantees gap-free
 * delivery even when many events land in the same millisecond.
 */
export async function getStreamEventsAfter(
  organizationId: string,
  afterCreatedAt: Date,
  options: { db?: AgentScopeDbOrTx; limit?: number } = {},
) {
  const db = options.db ?? defaultDb;
  const limit = options.limit ?? 50;
  return db.query.StreamEvent.findMany({
    where: and(
      eq(StreamEvent.organizationId, organizationId),
      gt(StreamEvent.createdAt, afterCreatedAt),
    ),
    orderBy: [asc(StreamEvent.createdAt), asc(StreamEvent.id)],
    limit,
  });
}

/**
 * Increment / decrement the SSE connection counter. Used by the route handler.
 * The counter is intentionally unlabeled to keep Prometheus cardinality
 * bounded — per-tenant SSE counts should be derived from logs.
 */
export function sseConnectionOpened(_organizationId: string) {
  sseConnections.inc();
}
export function sseConnectionClosed(_organizationId: string) {
  sseConnections.dec();
}

/**
 * Fire-and-forget helper that emits a stream event. Callers that want the
 * event also recorded as a `trackEvent` telemetry entry (with a real
 * sessionId) should call `trackEvent` themselves — this helper only writes
 * the stream event so non-session events (cost.recorded, alert.delivered,
 * splunk.investigation.completed, etc.) don't pollute telemetry with
 * synthetic SessionStarted entries.
 */
export async function emitStreamEvent(
  input: PublishInput,
  options: { db?: AgentScopeDbOrTx } = {},
): Promise<void> {
  await publishStreamEvent(input, options);
}
