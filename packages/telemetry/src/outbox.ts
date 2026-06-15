import { and, eq, sql } from "@agentscope/db";
import { db as defaultDb } from "@agentscope/db/client";
import { TelemetryOutbox } from "@agentscope/db/schema";
import {
  createLogger,
  outboxEventsDeliveredTotal,
  outboxEventsPending,
} from "@agentscope/observability";

import { forwardToSplunk, isSplunkEnabled } from "./splunk";

const logger = createLogger("telemetry.outbox");

type AgentScopeDb = typeof defaultDb;
type TelemetryOutboxRecord = typeof TelemetryOutbox.$inferSelect;

interface ProcessOptions {
  db?: AgentScopeDb;
  workerId?: string;
  limit?: number;
}

export async function enqueueSplunkOutbox(input: {
  db?: AgentScopeDb;
  eventId: string;
  sessionId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  if (!isSplunkEnabled()) return null;

  const [row] = await (input.db ?? defaultDb)
    .insert(TelemetryOutbox)
    .values({
      eventId: input.eventId,
      sessionId: input.sessionId,
      eventType: input.eventType,
      destination: "SplunkHEC",
      payload: input.payload,
      status: "Pending",
    })
    .returning();

  return row ?? null;
}

export async function processTelemetryOutboxBatch(
  options: ProcessOptions = {},
) {
  const db = options.db ?? defaultDb;
  const workerId = options.workerId ?? defaultWorkerId();
  const limit = options.limit ?? 25;
  let processed = 0;

  for (let i = 0; i < limit; i++) {
    const row = await claimNextOutboxEvent(db, workerId);
    if (!row) break;

    await deliverOutboxEvent(db, row);
    processed++;
  }

  return { processed };
}

export async function processTelemetryOutboxForSession(
  sessionId: string,
  options: ProcessOptions = {},
) {
  const db = options.db ?? defaultDb;
  const workerId = options.workerId ?? defaultWorkerId();
  const limit = options.limit ?? 50;
  let processed = 0;

  for (let i = 0; i < limit; i++) {
    const row = await claimNextOutboxEvent(db, workerId, sessionId);
    if (!row) break;

    await deliverOutboxEvent(db, row);
    processed++;
  }

  return { processed };
}

export async function reapStaleTelemetryOutbox(
  options: {
    db?: AgentScopeDb;
    staleAfterMs?: number;
  } = {},
) {
  const db = options.db ?? defaultDb;
  const staleBefore = new Date(
    Date.now() - (options.staleAfterMs ?? 5 * 60 * 1000),
  );

  // Preserve the original `runAfter` (or push it out 5 minutes if the
  // reaper found a row with no scheduled retry). The previous
  // implementation reset `runAfter` to `new Date()`, which meant a
  // reaped event was eligible for immediate re-delivery on the next
  // poll — a tight retry loop if the underlying transport (e.g.
  // Splunk HEC) is genuinely down. We use SQL `GREATEST` so that
  // existing `runAfter` in the future is preserved, but a reaped row
  // with no schedule (or a past schedule) is parked for at least
  // 5 minutes before the next attempt.
  const updated = await db
    .update(TelemetryOutbox)
    .set({
      status: "Failed",
      lockedAt: null,
      lockedBy: null,
      runAfter: sql`greatest(${TelemetryOutbox.runAfter}, now() + interval '5 minutes')`,
      lastError: "Telemetry outbox delivery lock expired.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(TelemetryOutbox.status, "Sending"),
        sql`${TelemetryOutbox.lockedAt} <= ${staleBefore}`,
      ),
    )
    .returning();

  return { reaped: updated.length };
}

/**
 * Lightweight snapshot of the telemetry outbox for the worker's /healthz
 * endpoint. The dashboard's Splunk readiness panel uses this to flag a
 * silent HEC outage (e.g. the worker can claim runs, but every event is
 * stuck in the outbox) before operators notice the investigation summary
 * is empty. Capped at `recentFailures` (5) so a transient blip doesn't
 * bloat the healthz payload; the pending counts are unbounded because
 * they are the primary signal.
 */
export interface OutboxHealthSnapshot {
  pending: number;
  failed: number;
  deadLettered: number;
  delivered: number;
  recentFailures: {
    id: string;
    sessionId: string;
    eventType: string;
    attempts: number;
    lastError: string | null;
    updatedAt: Date | null;
  }[];
}

export async function getTelemetryOutboxHealth(
  options: { db?: AgentScopeDb } = {},
): Promise<OutboxHealthSnapshot> {
  const db = options.db ?? defaultDb;

  try {
    const statusResult = await db.execute(sql`
      select
        count(*) filter (where status = 'Pending')::int   as pending,
        count(*) filter (where status = 'Failed')::int    as failed,
        count(*) filter (where status = 'DeadLettered')::int as dead_lettered,
        count(*) filter (where status = 'Delivered')::int as delivered
      from telemetry_outbox
    `);
    const statusRows = (
      Array.isArray(statusResult)
        ? statusResult
        : (statusResult as { rows?: unknown }).rows ?? []
    ) as Record<string, unknown>[];
    const statusRow: Record<string, unknown> = statusRows[0] ?? {
      pending: 0,
      failed: 0,
      dead_lettered: 0,
      delivered: 0,
    };

    const failuresResult = await db.execute(sql`
      select id, session_id, event_type, attempts, last_error, updated_at
      from telemetry_outbox
      where status in ('Failed', 'DeadLettered')
      order by updated_at desc nulls last
      limit 5
    `);

    const failureRows = (
      Array.isArray(failuresResult)
        ? failuresResult
        : (failuresResult as { rows?: unknown }).rows ?? []
    ) as Record<string, unknown>[];

    const failures = failureRows
      .filter((row): row is Record<string, unknown> => typeof row === "object")
      .map((row) => ({
        id: toStringSafe(row.id),
        sessionId: toStringSafe(row.session_id),
        eventType: toStringSafe(row.event_type),
        attempts: Number(row.attempts ?? 0),
        lastError: toStringSafe(row.last_error) || null,
        updatedAt: row.updated_at
          ? new Date(toStringSafe(row.updated_at))
          : null,
      }));

    return {
      pending: Number(statusRow.pending ?? 0),
      failed: Number(statusRow.failed ?? 0),
      deadLettered: Number(statusRow.dead_lettered ?? 0),
      delivered: Number(statusRow.delivered ?? 0),
      recentFailures: failures,
    };
  } catch (error) {
    // The /healthz endpoint is best-effort. If the DB is unreachable we
    // surface a degraded snapshot rather than throwing — throwing would
    // 500 the healthz probe and cause k8s to restart the worker, which
    // doesn't actually help if the DB is the problem.
    logger.warn(
      { err: error },
      "failed to read telemetry outbox health snapshot",
    );
    return {
      pending: 0,
      failed: 0,
      deadLettered: 0,
      delivered: 0,
      recentFailures: [],
    };
  }
}

async function claimNextOutboxEvent(
  db: AgentScopeDb,
  workerId: string,
  sessionId?: string,
) {
  const now = new Date();
  const sessionFilter = sessionId
    ? sql`and session_id = ${sessionId}`
    : sql``;
  const result = await db.execute(sql`
    with candidate as (
      select id
      from telemetry_outbox
      where status in ('Pending', 'Failed')
        and run_after <= ${now}
        ${sessionFilter}
      order by run_after asc, created_at asc
      for update skip locked
      limit 1
    )
    update telemetry_outbox
    set status = 'Sending',
        attempts = attempts + 1,
        locked_at = ${now},
        locked_by = ${workerId},
        last_error = null,
        updated_at = ${now}
    where id = (select id from candidate)
    returning id
  `);

  const id = rowsFromExecuteResult(result)[0]?.id;
  if (!id) return null;

  return db.query.TelemetryOutbox.findFirst({
    where: eq(TelemetryOutbox.id, id),
  });
}

async function deliverOutboxEvent(
  db: AgentScopeDb,
  row: TelemetryOutboxRecord,
) {
  try {
    await forwardToSplunk({
      sessionId: row.sessionId,
      eventType: row.eventType,
      payload: jsonRecord(row.payload),
    });

    await db
      .update(TelemetryOutbox)
      .set({
        status: "Delivered",
        lockedAt: null,
        lockedBy: null,
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(TelemetryOutbox.id, row.id));
    outboxEventsDeliveredTotal.inc({
      destination: row.destination,
      status: "ok",
    });
    await refreshOutboxPendingGauge(db);
  } catch (error) {
    outboxEventsDeliveredTotal.inc({
      destination: row.destination,
      status: "error",
    });
    logger.warn(
      { err: error, outboxId: row.id, attempts: row.attempts },
      "outbox delivery failed",
    );
    const attempts = row.attempts;
    const terminal = attempts >= row.maxAttempts;
    const retryDelayMs = Math.min(10 * 60 * 1000, 5000 * 2 ** attempts);

    await db
      .update(TelemetryOutbox)
      .set({
        status: terminal ? "DeadLettered" : "Failed",
        lockedAt: null,
        lockedBy: null,
        runAfter: terminal
          ? row.runAfter
          : new Date(Date.now() + retryDelayMs),
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(TelemetryOutbox.id, row.id));
  }
}

async function refreshOutboxPendingGauge(db: AgentScopeDb) {
  try {
    const result = await db.execute(
      sql`select count(*)::int as count from telemetry_outbox where status in ('Pending', 'Failed')`,
    );
    const rows = countRowsFromExecuteResult(result);
    const count = rows[0]?.count;
    if (typeof count === "number") {
      outboxEventsPending.set(count);
    }
  } catch {
    // Best-effort metric refresh.
  }
}

function countRowsFromExecuteResult(result: unknown): { count: number }[] {
  if (Array.isArray(result)) {
    return result.filter(hasCount);
  }
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows.filter(hasCount) : [];
}

function hasCount(value: unknown): value is { count: number } {
  if (typeof value !== "object" || value === null) return false;
  const c = (value as { count?: unknown }).count;
  return typeof c === "number" || typeof c === "string";
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rowsFromExecuteResult(result: unknown): { id: string }[] {
  if (Array.isArray(result)) {
    return result.filter(hasId);
  }

  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows.filter(hasId) : [];
}

function hasId(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/**
 * Safely stringify an `unknown` value. Used when extracting columns from
 * raw `db.execute()` rows (which are typed as `Record<string, unknown>`)
 * so the linter doesn't flag `String(unknown)` as a base-to-string risk.
 *
 * Handles `Date` specially because Drizzle's `db.execute()` returns
 * `Date` instances from `timestamptz` columns — we must serialize them
 * to ISO 8601 so `new Date(stringified)` round-trips correctly.
 */
function toStringSafe(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function defaultWorkerId() {
  return `agentscope-telemetry-${process.pid}`;
}
