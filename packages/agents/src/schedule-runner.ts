import { desc, eq } from "@agentscope/db";
import {
  AgentRun,
  AgentRunApproval,
  AgentVersion,
} from "@agentscope/db/schema";
import type { Agent as AgentTable } from "@agentscope/db/schema";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
  NodePgDatabase,
  NodePgTransaction,
} from "drizzle-orm/node-postgres";

import type * as schema from "@agentscope/db/schema";

type AgentScopeDbOrTx =
  | NodePgDatabase<typeof schema>
  | NodePgTransaction<
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >;
type AgentRecord = typeof AgentTable.$inferSelect;

/**
 * Enqueue a run from a schedule (or any internal caller).
 * Returns the created run.
 */
export async function enqueueAgentRunForSchedule(
  db: AgentScopeDbOrTx,
  input: {
    organizationId: string;
    agent: AgentRecord;
    input: string;
    requestedByUserId: string;
  },
) {
  const version = await latestAgentVersion(db, input.agent.id);

  const status = input.agent.requiresApproval ? "AwaitingApproval" : "Queued";
  if (!input.requestedByUserId) {
    throw new Error(
      `Cannot enqueue scheduled run: requestedByUserId is required (agentId=${input.agent.id}).`,
    );
  }
  const [run] = await db
    .insert(AgentRun)
    .values({
      organizationId: input.organizationId,
      agentId: input.agent.id,
      agentVersionId: version?.id,
      requestedByUserId: input.requestedByUserId,
      status,
      input: input.input,
    })
    .returning();

  if (!run) {
    throw new Error("Failed to enqueue agent run for schedule.");
  }

  if (status === "AwaitingApproval") {
    await db.insert(AgentRunApproval).values({
      organizationId: input.organizationId,
      agentRunId: run.id,
      requestedByUserId: input.requestedByUserId,
      status: "Pending",
      reason: "Scheduled run requires human approval before execution.",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }

  return run;
}

async function latestAgentVersion(db: AgentScopeDbOrTx, agentId: string) {
  return db.query.AgentVersion.findFirst({
    where: eq(AgentVersion.agentId, agentId),
    orderBy: desc(AgentVersion.version),
  });
}
