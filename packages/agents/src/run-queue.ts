import { and, eq, sql } from "@agentscope/db";
import { db as defaultDb } from "@agentscope/db/client";
import {
  AgentRun,
  AgentRunDeadLetter,
  Agent as AgentTable,
} from "@agentscope/db/schema";
import { decryptSecret } from "@agentscope/auth";
import {
  agentRunsTotal,
  agentRunDurationSeconds,
  createLogger,
} from "@agentscope/observability";
import {
  emitStreamEvent,
  processTelemetryOutboxForSession,
} from "@agentscope/telemetry";

import { evaluateRunAlerts } from "./alerts";
import { evaluateAgentCostBudgets, recordAgentRunCost } from "./cost-budget";
import {
  markEvaluationRunsRunning,
  runEvaluationForAgentRun,
} from "./eval-runner";
import { createRuntimeAgent } from "./runtime";
import {
  PermanentAgentRunError,
  runFailureTransition,
} from "./run-queue-policy";
import { investigateSessionWithSplunk } from "./splunk-investigator";

const logger = createLogger("agents.run-queue");

type AgentScopeDb = typeof defaultDb;
type AgentRunRecord = typeof AgentRun.$inferSelect;

interface ExecuteOptions {
  db?: AgentScopeDb;
  workerId?: string;
}

export async function executeNextAgentRun(
  options: ExecuteOptions = {},
): Promise<AgentRunRecord | null> {
  const db = options.db ?? defaultDb;
  const workerId = options.workerId ?? defaultWorkerId();
  const run = await claimNextAgentRun(db, workerId);

  if (!run) return null;

  return processClaimedAgentRun(db, run, workerId);
}

export async function executeAgentRunById(
  runId: string,
  options: ExecuteOptions = {},
): Promise<AgentRunRecord | null> {
  const db = options.db ?? defaultDb;
  const workerId = options.workerId ?? defaultWorkerId();
  const run = await claimAgentRunById(db, runId, workerId);

  if (!run) return null;

  return processClaimedAgentRun(db, run, workerId);
}

async function claimNextAgentRun(db: AgentScopeDb, workerId: string) {
  const now = new Date();
  const runId = await claimRunId(
    db,
    sql`
      with candidate as (
        select id
        from agent_run
        where status in ('Queued', 'Retrying')
          and run_after <= ${now}
        order by run_after asc, created_at asc
        for update skip locked
        limit 1
      )
      update agent_run
      set status = 'Running',
          attempts = attempts + 1,
          locked_at = ${now},
          locked_by = ${workerId},
          started_at = coalesce(started_at, ${now}),
          error = null,
          updated_at = ${now}
      where id = (select id from candidate)
      returning id
    `,
  );

  if (!runId) return null;

  return db.query.AgentRun.findFirst({
    where: eq(AgentRun.id, runId),
  });
}

async function claimAgentRunById(
  db: AgentScopeDb,
  runId: string,
  workerId: string,
) {
  const now = new Date();
  const claimedRunId = await claimRunId(
    db,
    sql`
      with candidate as (
        select id
        from agent_run
        where id = ${runId}
          and status in ('Queued', 'Retrying')
        for update skip locked
        limit 1
      )
      update agent_run
      set status = 'Running',
          attempts = attempts + 1,
          locked_at = ${now},
          locked_by = ${workerId},
          started_at = coalesce(started_at, ${now}),
          error = null,
          updated_at = ${now}
      where id = (select id from candidate)
      returning id
    `,
  );

  if (!claimedRunId) return null;

  return db.query.AgentRun.findFirst({
    where: eq(AgentRun.id, claimedRunId),
  });
}

export async function reapStaleAgentRuns(
  options: ExecuteOptions & { staleAfterMs?: number } = {},
) {
  const db = options.db ?? defaultDb;
  const staleBefore = new Date(
    Date.now() - (options.staleAfterMs ?? 10 * 60 * 1000),
  );
  const staleRuns = await db.query.AgentRun.findMany({
    where: and(
      eq(AgentRun.status, "Running"),
      sql`${AgentRun.lockedAt} <= ${staleBefore}`,
    ),
    limit: 50,
  });

  let reaped = 0;
  for (const run of staleRuns) {
    await failOrRetryRun(
      db,
      run,
      new Error("Agent run lock expired before completion."),
    );
    reaped++;
  }

  return { reaped };
}

async function processClaimedAgentRun(
  db: AgentScopeDb,
  run: AgentRunRecord,
  workerId: string,
) {
  const start = Date.now();
  try {
    const agent = await db.query.Agent.findFirst({
      where: and(
        eq(AgentTable.id, run.agentId),
        eq(AgentTable.organizationId, run.organizationId),
      ),
    });

    if (!agent) {
      throw new PermanentAgentRunError("Agent no longer exists.");
    }

    // Cost budget check. We take a transaction-scoped advisory lock keyed on
    // (org, agent) so two concurrent runs cannot both pass the budget check
    // and both execute past the cap. The lock is released automatically when
    // the surrounding transaction commits/rolls back. Key is a JS string
    // concat (not `||`) so the agentId is never silently dropped.
    const budget = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${run.organizationId + ":" + run.agentId}, 0))`,
      );
      return evaluateAgentCostBudgets(tx, run.organizationId, agent.id);
    });
    if (!budget.allowed) {
      logger.warn(
        { runId: run.id, agentId: agent.id, reason: budget.reason },
        "agent run blocked by cost budget",
      );
      throw new PermanentAgentRunError(budget.reason);
    }

    const runtime = createRuntimeAgent({
      id: agent.id,
      type: agent.type,
      config: {
        name: agent.name,
        description: agent.description ?? "",
        organizationId: run.organizationId,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        systemPrompt:
          agent.systemPrompt ??
          "You are an AI operations analyst investigating agent behavior with Splunk evidence.",
        baseUrl: agent.baseUrl ?? null,
        apiKey: decryptSecret(agent.apiKeyEncrypted),
        costPer1kTokens: agent.costPer1kTokens,
      },
    });

    await emitStreamEvent({
      organizationId: run.organizationId,
      eventType: "agent_run.started",
      resourceType: "agent_run",
      resourceId: run.id,
      payload: { agentId: agent.id, runId: run.id },
    });

    // Flip any linked `AgentEvaluationRun` rows from `Queued` to `Running`
    // so the UI can show that scoring is in progress. Idempotent: rows in
    // any other state are left alone.
    await markEvaluationRunsRunning(db, { agentRunId: run.id });

    const result = await runtime.execute(run.input, {
      organizationId: run.organizationId,
    });

    await processTelemetryOutboxForSession(result.sessionId, {
      db,
      workerId,
      limit: 100,
    });

    const investigation = await investigateSessionWithSplunk({
      sessionId: result.sessionId,
      task: run.input,
      agentName: agent.name,
      output: result.output,
      providerConfig: {
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        baseUrl: agent.baseUrl,
        apiKey: decryptSecret(agent.apiKeyEncrypted),
      },
    });

    // Persist the state change, the cost ledger entry, and the SSE
    // `agent_run.completed` stream event in a single transaction. A worker
    // crash between the UPDATE and the emit would otherwise leave the
    // SSE timeline missing the completion event.
    const completed = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(AgentRun)
        .set({
          status: "Completed",
          sessionId: result.sessionId,
          output: result.output,
          error: null,
          lockedAt: null,
          lockedBy: null,
          completedAt: new Date(),
          totalTokens: result.totalTokens,
          totalCost: result.totalCost,
          toolCalls: result.toolCalls,
          investigation,
          updatedAt: new Date(),
        })
        .where(eq(AgentRun.id, run.id))
        .returning();
      if (!updated) return null;
      await recordAgentRunCost(tx, updated);
      await emitStreamEvent(
        {
          organizationId: updated.organizationId,
          eventType: "agent_run.completed",
          resourceType: "agent_run",
          resourceId: updated.id,
          payload: {
            status: updated.status,
            totalTokens: updated.totalTokens,
            totalCost: updated.totalCost,
          },
        },
        { db: tx },
      );
      return updated;
    });

    if (completed) {
      await evaluateRunAlerts(db, completed);
      agentRunsTotal.inc({ status: "Completed" });
      agentRunDurationSeconds.observe(
        { status: "Completed" },
        (Date.now() - start) / 1000,
      );
    }

    // Score any linked evaluation runs. A broken scorer must never
    // affect run-state transitions, so its errors are swallowed and
    // logged.
    try {
      await runEvaluationForAgentRun(db, { agentRunId: run.id });
    } catch (evalError) {
      logger.error(
        { err: evalError, runId: run.id },
        "evaluation scoring failed; continuing",
      );
    }

    return completed ?? null;
  } catch (error) {
    agentRunsTotal.inc({ status: "Failed" });
    agentRunDurationSeconds.observe(
      { status: "Failed" },
      (Date.now() - start) / 1000,
    );
    logger.error(
      { err: error, runId: run.id },
      "agent run processing failed",
    );
    const updated = await failOrRetryRun(db, run, error);
    if (updated) {
      await db.transaction(async (tx) => {
        await emitStreamEvent(
          {
            organizationId: updated.organizationId,
            eventType:
              updated.status === "DeadLettered"
                ? "agent_run.dead_lettered"
                : updated.status === "Cancelled"
                  ? "agent_run.cancelled"
                  : "agent_run.failed",
            resourceType: "agent_run",
            resourceId: updated.id,
            payload: { status: updated.status, error: updated.error },
          },
          { db: tx },
        );
      });
    }
    // Score linked evaluation runs even on failure so the UI sees an
    // `Errored` evaluation rather than a run stuck in `Running`. The
    // scorer is idempotent and the call is wrapped to keep run state
    // transitions independent of scoring health.
    try {
      await runEvaluationForAgentRun(db, { agentRunId: run.id });
    } catch (evalError) {
      logger.error(
        { err: evalError, runId: run.id },
        "evaluation scoring failed after run error; continuing",
      );
    }
    return updated;
  }
}

async function failOrRetryRun(
  db: AgentScopeDb,
  run: AgentRunRecord,
  error: unknown,
) {
  const permanent = error instanceof PermanentAgentRunError;
  const now = new Date();
  const transition = runFailureTransition({
    attempts: run.attempts,
    maxAttempts: run.maxAttempts,
    permanent,
    now,
  });

  const [updated] = await db
    .update(AgentRun)
    .set({
      status: transition.status,
      error: error instanceof Error ? error.message : String(error),
      lockedAt: null,
      lockedBy: null,
      runAfter: transition.runAfter,
      completedAt: transition.completedAt,
      deadLetteredAt:
        transition.status === "DeadLettered" ? transition.completedAt : null,
      updatedAt: now,
    })
    .where(eq(AgentRun.id, run.id))
    .returning();

  if (updated?.status === "DeadLettered") {
    await createDeadLetter(db, updated, error);
    await evaluateRunAlerts(db, updated);
  }

  return updated ?? null;
}

async function createDeadLetter(
  db: AgentScopeDb,
  run: AgentRunRecord,
  error: unknown,
) {
  await db
    .insert(AgentRunDeadLetter)
    .values({
      organizationId: run.organizationId,
      agentRunId: run.id,
      failureClass:
        error instanceof PermanentAgentRunError
          ? "PermanentAgentRunError"
          : error instanceof Error
            ? error.name
            : "UnknownFailure",
      reason: error instanceof Error ? error.message : String(error),
      payload: {
        attempts: run.attempts,
        maxAttempts: run.maxAttempts,
        agentId: run.agentId,
        sessionId: run.sessionId,
      },
      retryable: !(error instanceof PermanentAgentRunError),
    })
    .onConflictDoNothing();
}

function defaultWorkerId() {
  return `agentscope-worker-${process.pid}`;
}

async function claimRunId(
  db: AgentScopeDb,
  query: ReturnType<typeof sql>,
): Promise<string | null> {
  const result = await db.execute(query);
  const rows = rowsFromExecuteResult(result);
  return rows[0]?.id ?? null;
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
