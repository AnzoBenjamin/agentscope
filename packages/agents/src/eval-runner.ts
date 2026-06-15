import { and, asc, eq } from "@agentscope/db";
import {
  AgentEvaluation,
  AgentEvaluationRun,
  AgentRun,
  Event,
} from "@agentscope/db/schema";
import { createLogger } from "@agentscope/observability";

import type { AgentScopeDb } from "./tool-executor";

export type EvaluationDecision = "Passed" | "Failed" | "Errored";

export interface EvaluationScore {
  matchedSignals: string[];
  missingSignals: string[];
  score: number;
  passThreshold: number;
  decision: EvaluationDecision;
  error?: string;
}

export interface EvalRunFinding {
  signal: string | null;
  matched?: boolean;
  error?: string;
}

export interface ScorableEvent {
  eventType: string;
  payload: unknown;
}

const logger = createLogger("agents.eval-runner");

/**
 * Pure scoring function. Given a list of recorded events and a list of
 * expected signals (strings or regexes), return which signals matched,
 * which were missing, and whether the run meets the pass threshold.
 *
 * A signal matches an event if:
 *  - the signal equals the event's `eventType`,
 *  - the signal equals the event payload's `toolName` (when present),
 *  - the lowercased event JSON contains the lowercased signal as a substring, or
 *  - the signal is a valid regex that matches the event JSON.
 */
export function scoreEvaluation(input: {
  events: ScorableEvent[];
  expectedSignals: string[];
  passThreshold: number;
}): EvaluationScore {
  const { events, expectedSignals, passThreshold } = input;

  if (expectedSignals.length === 0) {
    return {
      matchedSignals: [],
      missingSignals: [],
      score: 1,
      passThreshold,
      decision: "Passed",
    };
  }

  const matched: string[] = [];
  const missing: string[] = [];
  for (const signal of expectedSignals) {
    if (events.some((event) => matchesSignal(event, signal))) {
      matched.push(signal);
    } else {
      missing.push(signal);
    }
  }
  const score = matched.length / expectedSignals.length;
  return {
    matchedSignals: matched,
    missingSignals: missing,
    score,
    passThreshold,
    decision: score >= passThreshold ? "Passed" : "Failed",
  };
}

function matchesSignal(event: ScorableEvent, signal: string): boolean {
  if (event.eventType === signal) return true;
  const payload = event.payload;
  if (isPlainObject(payload)) {
    if (typeof payload.toolName === "string" && payload.toolName === signal) {
      return true;
    }
  }
  const haystack = JSON.stringify({
    eventType: event.eventType,
    payload,
  });
  if (haystack.toLowerCase().includes(signal.toLowerCase())) return true;
  // Also test the signal as a regex against the event type, payload
  // string, and the full JSON envelope. A signal like `^Splunk.*` should
  // match `SplunkMcpSearch` directly even though the JSON envelope
  // starts with `{`.
  if (tryRegex(signal, event.eventType)) return true;
  if (isPlainObject(payload)) {
    const payloadStr = JSON.stringify(payload);
    if (tryRegex(signal, payloadStr)) return true;
  }
  return tryRegex(signal, haystack);
}

function tryRegex(signal: string, text: string): boolean {
  try {
    return new RegExp(signal, "i").test(text);
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/**
 * Mark every `AgentEvaluationRun` linked to the given agent run as
 * `Running` with a startedAt timestamp. Idempotent: only `Queued`
 * rows are transitioned. Returns the number of rows that flipped.
 */
export async function markEvaluationRunsRunning(
  db: AgentScopeDb,
  input: { agentRunId: string },
): Promise<number> {
  const now = new Date();
  const updated = await db
    .update(AgentEvaluationRun)
    .set({
      status: "Running",
      startedAt: now,
      error: null,
    })
    .where(
      and(
        eq(AgentEvaluationRun.agentRunId, input.agentRunId),
        eq(AgentEvaluationRun.status, "Queued"),
      ),
    )
    .returning({ id: AgentEvaluationRun.id });
  return updated.length;
}

/**
 * Score every `AgentEvaluationRun` linked to the given agent run.
 * Loads the events for the run's session, runs `scoreEvaluation` for
 * each linked evaluation, and writes the status / score / findings /
 * error / completedAt back to the database.
 *
 * Idempotent: only `Queued` and `Running` rows are processed, so it's
 * safe to call from both the success and failure paths of the run
 * queue without double-scoring.
 */
export async function runEvaluationForAgentRun(
  db: AgentScopeDb,
  input: { agentRunId: string },
): Promise<{ evaluationRunId: string; score: EvaluationScore }[]> {
  const evaluationRuns = await db.query.AgentEvaluationRun.findMany({
    where: eq(AgentEvaluationRun.agentRunId, input.agentRunId),
  });
  const toProcess = evaluationRuns.filter(
    (er) => er.status === "Queued" || er.status === "Running",
  );
  if (toProcess.length === 0) return [];

  const run = await db.query.AgentRun.findFirst({
    where: eq(AgentRun.id, input.agentRunId),
  });

  if (!run?.sessionId) {
    const message = "Agent run has no session ID; cannot load events.";
    for (const er of toProcess) {
      await db
        .update(AgentEvaluationRun)
        .set({
          status: "Errored",
          error: message,
          findings: [{ signal: null, error: message }],
          completedAt: new Date(),
        })
        .where(eq(AgentEvaluationRun.id, er.id));
    }
    return toProcess.map((er) => ({
      evaluationRunId: er.id,
      score: {
        matchedSignals: [],
        missingSignals: [],
        score: 0,
        passThreshold: 0,
        decision: "Errored",
        error: message,
      },
    }));
  }

  const events = await db.query.Event.findMany({
    where: eq(Event.sessionId, run.sessionId),
    orderBy: asc(Event.createdAt),
  });
  const eventSummaries: ScorableEvent[] = events.map((e) => ({
    eventType: e.eventType,
    payload: e.payload,
  }));

  const results: { evaluationRunId: string; score: EvaluationScore }[] = [];
  for (const er of toProcess) {
    const evaluation = await db.query.AgentEvaluation.findFirst({
      where: eq(AgentEvaluation.id, er.evaluationId),
    });

    if (!evaluation) {
      const message = `Evaluation ${er.evaluationId} not found.`;
      await db
        .update(AgentEvaluationRun)
        .set({
          status: "Errored",
          error: message,
          findings: [{ signal: null, error: message }],
          completedAt: new Date(),
        })
        .where(eq(AgentEvaluationRun.id, er.id));
      results.push({
        evaluationRunId: er.id,
        score: {
          matchedSignals: [],
          missingSignals: [],
          score: 0,
          passThreshold: 0,
          decision: "Errored",
          error: message,
        },
      });
      continue;
    }

    let score: EvaluationScore;
    try {
      const expectedSignals = Array.isArray(evaluation.expectedSignals)
        ? (evaluation.expectedSignals as unknown[]).filter(
            (s): s is string => typeof s === "string",
          )
        : [];
      score = scoreEvaluation({
        events: eventSummaries,
        expectedSignals,
        passThreshold: evaluation.passThreshold,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { evaluationRunId: er.id, err: message },
        "evaluation scoring threw",
      );
      score = {
        matchedSignals: [],
        missingSignals: [],
        score: 0,
        passThreshold: evaluation.passThreshold,
        decision: "Errored",
        error: message,
      };
    }

    const findings: EvalRunFinding[] = [
      ...score.matchedSignals.map((s) => ({ signal: s, matched: true })),
      ...score.missingSignals.map((s) => ({ signal: s, matched: false })),
    ];
    if (score.error) findings.push({ signal: null, error: score.error });

    await db
      .update(AgentEvaluationRun)
      .set({
        status: score.decision,
        score: score.score,
        findings,
        error: score.error ?? null,
        completedAt: new Date(),
      })
      .where(eq(AgentEvaluationRun.id, er.id));

    results.push({ evaluationRunId: er.id, score });
  }
  return results;
}
