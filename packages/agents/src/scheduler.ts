import { and, eq, lte } from "@agentscope/db";
import { db as defaultDb } from "@agentscope/db/client";
import {
  Agent as AgentTable,
  AgentSchedule,
  AgentScheduleRun,
} from "@agentscope/db/schema";
import type * as schema from "@agentscope/db/schema";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import { scheduledRunTriggersTotal, createLogger } from "@agentscope/observability";

import { enqueueAgentRunForSchedule } from "./schedule-runner";

type AgentScopeDb = typeof defaultDb;
// Transaction handle matching the schema attached to `defaultDb`. Used to
// type the `tx` callback parameter of `db.transaction(...)` — Drizzle's
// inferred type is the wider `PgTransaction<HKT, ...>` which doesn't match
// the narrower `AgentScopeDb` (the latter includes `$client: Pool` from the
// pool intersection on `defaultDb`). Same pattern as `cost-budget.ts`.
type AgentScopeTx = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

const logger = createLogger("agents.scheduler");

interface TriggerOptions {
  db?: AgentScopeDb;
  now?: Date;
  limit?: number;
}

const frequencyMs: Record<string, number | null> = {
  Once: null,
  Hourly: 60 * 60 * 1000,
  Daily: 24 * 60 * 60 * 1000,
  Weekly: 7 * 24 * 60 * 60 * 1000,
  Monthly: 30 * 24 * 60 * 60 * 1000,
  Cron: null, // cron requires an external parser; treated like Daily for next-run
};

export type ScheduleFrequency =
  | "Once"
  | "Hourly"
  | "Daily"
  | "Weekly"
  | "Monthly"
  | "Cron";

function nextRunFor(frequency: ScheduleFrequency, from: Date): Date {
  const offset = frequencyMs[frequency];
  if (offset === null || offset === undefined) {
    return from;
  }
  return new Date(from.getTime() + offset);
}

/**
 * Trigger any agent schedules whose `nextRunAt` has passed.
 * Returns the number of schedules triggered.
 */
export async function triggerDueSchedules(
  options: TriggerOptions = {},
): Promise<{ triggered: number }> {
  const db = options.db ?? defaultDb;
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;
  let triggered = 0;

  const due = await db
    .select()
    .from(AgentSchedule)
    .where(
      and(
        eq(AgentSchedule.enabled, true),
        lte(AgentSchedule.nextRunAt, now),
      ),
    )
    .limit(limit);

  for (const schedule of due) {
    // Wrap each per-schedule transaction in a try/catch so a single broken
    // schedule (missing cron parser, stale data, DB constraint violation)
    // cannot crash-loop the worker. On error we disable the schedule in a
    // separate write so the next tick does not re-pick it.
    let result: unknown = null;
    try {
      result = await db.transaction(async (tx: AgentScopeTx) => {
      // Re-claim with row lock to avoid double-triggering when multiple
      // workers run the scheduler concurrently. The WHERE clause bumps
      // `nextRunAt` by 60s as a "claim window"; only the worker that
      // actually performs the UPDATE will see non-empty `.returning()`,
      // so concurrent schedulers see claimed schedules and skip them.
      const claimed = await tx
        .update(AgentSchedule)
        .set({
          nextRunAt: new Date(now.getTime() + 60_000),
          updatedAt: now,
        })
        .where(
          and(eq(AgentSchedule.id, schedule.id), lte(AgentSchedule.nextRunAt, now)),
        )
        .returning();

      if (claimed.length === 0) return null;

      const agent = await tx.query.Agent.findFirst({
        where: and(
          eq(AgentTable.id, schedule.agentId),
          eq(AgentTable.organizationId, schedule.organizationId),
        ),
      });
      if (!agent) return null;

      if (!schedule.createdByUserId) {
        throw new Error(
          `Schedule ${schedule.id} is missing createdByUserId; cannot enqueue run.`,
        );
      }
      const run = await enqueueAgentRunForSchedule(tx, {
        organizationId: schedule.organizationId,
        agent,
        input: schedule.inputPrompt,
        requestedByUserId: schedule.createdByUserId,
      });

      const [scheduleRun] = await tx
        .insert(AgentScheduleRun)
        .values({
          organizationId: schedule.organizationId,
          scheduleId: schedule.id,
          agentRunId: run.id,
          scheduledFor: now,
          status: run.status,
        })
        .returning();

      // Update schedule's nextRunAt based on frequency. Cron expressions
      // require a parser that we don't depend on yet; for now we surface
      // a clear error so the operator knows the schedule will not fire
      // until cron support is wired up.
      const frequency = schedule.frequency as ScheduleFrequency;
      let nextAt: Date;
      if (frequency === "Once") {
        nextAt = now;
      } else if (frequency === "Cron") {
        throw new Error(
          `Schedule ${schedule.id} uses frequency=Cron but no cron parser is configured. ` +
            `Add a cron parser (e.g. croner) and compute nextAt from schedule.cron.`,
        );
      } else {
        nextAt = nextRunFor(frequency, now);
      }
      await tx
        .update(AgentSchedule)
        .set({
          nextRunAt: nextAt,
          lastRunAt: now,
          enabled: frequency === "Once" ? false : schedule.enabled,
          updatedAt: now,
        })
        .where(eq(AgentSchedule.id, schedule.id));

      return scheduleRun;
    });
    } catch (err) {
      logger.error(
        {
          err,
          scheduleId: schedule.id,
          frequency: schedule.frequency,
        },
        "scheduler tick failed; disabling schedule to prevent crash-loop",
      );
      try {
        await db
          .update(AgentSchedule)
          .set({ enabled: false, updatedAt: now })
          .where(eq(AgentSchedule.id, schedule.id));
      } catch (disableErr) {
        logger.error(
          { err: disableErr, scheduleId: schedule.id },
          "failed to disable broken schedule; will retry next tick",
        );
      }
      continue;
    }

    if (result) {
      scheduledRunTriggersTotal.inc({
        frequency: schedule.frequency,
      });
      triggered++;
    }
  }

  if (triggered > 0) {
    logger.info({ triggered }, "triggered scheduled agent runs");
  }

  return { triggered };
}
