import { createHash } from "node:crypto";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { db as defaultDb } from "@agentscope/db/client";
import { and, desc, eq } from "@agentscope/db";
import {
  Agent,
  AGENT_TOOL_SCOPES,
  AGENT_RUN_STATUSES,
  AGENT_TYPES,
  AgentEvaluation,
  AgentEvaluationRun,
  AgentRun,
  AgentRunApproval,
  AgentToolDefinition,
  AgentToolGrant,
  AgentVersion,
  IdempotencyKey,
  ORGANIZATION_ROLES,
} from "@agentscope/db/schema";
import { encryptSecret } from "@agentscope/auth/secrets";

import { writeAuditLog } from "../audit";
import { canCreateAgent, canEnqueueRun, evaluateAgentBudget } from "../entitlements";
import { requireRole } from "../trpc";

const enqueueRunInput = z.object({
  agentId: z.string(),
  input: z.string().min(1).max(4096),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

type AgentDb = typeof defaultDb;
type AgentDbTransaction = Parameters<Parameters<AgentDb["transaction"]>[0]>[0];
type AgentDbClient = AgentDb | AgentDbTransaction;

type AgentRow = typeof Agent.$inferSelect;

/**
 * Strip the encrypted API key from an agent row before returning it to the
 * client. The `hasApiKey` boolean lets the UI render a "configured" badge
 * without exposing ciphertext.
 */
function toPublicAgent(row: AgentRow) {
  const { apiKeyEncrypted: _apiKeyEncrypted, ...rest } = row;
  return {
    ...rest,
    hasApiKey: typeof _apiKeyEncrypted === "string" && _apiKeyEncrypted.length > 0,
  };
}

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "Base URL must be an http(s) URL.",
  );

export const agentRouter = {
  all: requireRole("Viewer").query(async ({ ctx }) => {
    const rows = await ctx.db.query.Agent.findMany({
      where: eq(Agent.organizationId, ctx.organizationId),
      orderBy: desc(Agent.createdAt),
    });
    return rows.map(toPublicAgent);
  }),

  byId: requireRole("Viewer")
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.Agent.findFirst({
        where: and(
          eq(Agent.id, input.id),
          eq(Agent.organizationId, ctx.organizationId),
        ),
      });
      return row ? toPublicAgent(row) : null;
    }),

  create: requireRole("Manager")
    .input(
      z.object({
        name: z.string().max(256),
        description: z.string().max(1024).optional(),
        type: z.enum(AGENT_TYPES).default("Research"),
        modelProvider: z.string().max(128),
        modelName: z.string().max(128),
        systemPrompt: z.string().max(10_000).optional(),
        requiresApproval: z.boolean().default(false),
        baseUrl: httpUrl.optional(),
        apiKey: z.string().max(4096).optional(),
        costPer1kTokens: z.number().min(0).max(1000).default(0.03),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entitlement = await canCreateAgent(ctx.db, ctx.organizationId);
      if (!entitlement.allowed) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: entitlement.reason,
        });
      }

      const apiKeyEncrypted = encryptSecret(input.apiKey);
      const normalizedBaseUrl =
        input.baseUrl && input.baseUrl.trim() !== "" ? input.baseUrl : null;

      const [agent] = await ctx.db
        .insert(Agent)
        .values({
          name: input.name,
          description: input.description ?? "",
          type: input.type,
          modelProvider: input.modelProvider,
          modelName: input.modelName,
          systemPrompt: input.systemPrompt ?? "",
          requiresApproval: input.requiresApproval,
          baseUrl: normalizedBaseUrl,
          apiKeyEncrypted,
          costPer1kTokens: input.costPer1kTokens,
          organizationId: ctx.organizationId,
          latestVersion: 1,
        })
        .returning();

      if (!agent) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create agent.",
        });
      }

      await createAgentVersion(ctx.db, agent, ctx.session.user.id, "Created");
      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "agent.create",
        resourceType: "agent",
        resourceId: agent.id,
        payload: {
          name: agent.name,
          type: agent.type,
          modelProvider: agent.modelProvider,
          modelName: agent.modelName,
          baseUrl: agent.baseUrl,
          hasApiKey: typeof apiKeyEncrypted === "string",
        },
      });

      return toPublicAgent(agent);
    }),

  update: requireRole("Manager")
    .input(
      z.object({
          id: z.string(),
          name: z.string().max(256).optional(),
          description: z.string().max(1024).optional(),
          type: z.enum(AGENT_TYPES).optional(),
          modelProvider: z.string().max(128).optional(),
          modelName: z.string().max(128).optional(),
          systemPrompt: z.string().max(10_000).optional(),
          status: z.string().max(32).optional(),
          requiresApproval: z.boolean().optional(),
          toolMode: z.enum(["Restricted", "AllGranted"]).optional(),
          baseUrl: httpUrl.nullable().optional(),
          apiKey: z.string().max(4096).nullable().optional(),
          clearApiKey: z.boolean().optional(),
          costPer1kTokens: z.number().min(0).max(1000).optional(),
          changeSummary: z.string().max(1000).optional(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const {
        id,
        changeSummary,
        apiKey: plaintextKey,
        clearApiKey,
        baseUrl: rawBaseUrl,
        ...data
      } = input;
      const current = await ctx.db.query.Agent.findFirst({
        where: and(
          eq(Agent.id, id),
          eq(Agent.organizationId, ctx.organizationId),
        ),
      });

      if (!current) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Agent not found in this organization.",
        });
      }

      const nextBaseUrl =
        rawBaseUrl === undefined
          ? undefined
          : rawBaseUrl === null || rawBaseUrl.trim() === ""
            ? null
            : rawBaseUrl;

      const apiKeyUpdate =
        clearApiKey === true
          ? { kind: "clear" as const }
          : typeof plaintextKey === "string" && plaintextKey.length > 0
            ? { kind: "set" as const, value: encryptSecret(plaintextKey) }
            : { kind: "keep" as const };

      const versioned =
        changesVersionedRuntime(data) ||
        nextBaseUrl !== undefined ||
        apiKeyUpdate.kind !== "keep" ||
        data.costPer1kTokens !== undefined;
      const nextVersion = versioned ? current.latestVersion + 1 : undefined;
      const updateValues: Partial<typeof Agent.$inferInsert> = {
        ...data,
        latestVersion: nextVersion ?? current.latestVersion,
        updatedAt: new Date(),
      };
      if (nextBaseUrl !== undefined) updateValues.baseUrl = nextBaseUrl;
      if (apiKeyUpdate.kind === "clear") {
        updateValues.apiKeyEncrypted = null;
      } else if (apiKeyUpdate.kind === "set") {
        updateValues.apiKeyEncrypted = apiKeyUpdate.value;
      }
      if (data.costPer1kTokens !== undefined) {
        updateValues.costPer1kTokens = data.costPer1kTokens;
      }

      await ctx.db
        .update(Agent)
        .set(updateValues)
        .where(
          and(eq(Agent.id, id), eq(Agent.organizationId, ctx.organizationId)),
        );

      const updated = await ctx.db.query.Agent.findFirst({
        where: and(
          eq(Agent.id, id),
          eq(Agent.organizationId, ctx.organizationId),
        ),
      });

      if (updated && versioned) {
        await createAgentVersion(
          ctx.db,
          updated,
          ctx.session.user.id,
          changeSummary ?? "Updated runtime configuration",
        );
      }

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "agent.update",
        resourceType: "agent",
        resourceId: id,
        payload: {
          ...data,
          baseUrl: nextBaseUrl,
          apiKeyAction:
            apiKeyUpdate.kind === "set"
              ? "set"
              : apiKeyUpdate.kind === "clear"
                ? "clear"
                : "keep",
        },
      });

      return updated ? toPublicAgent(updated) : null;
    }),

  delete: requireRole("Manager")
    .input(z.string())
    .mutation(({ ctx, input }) => {
      return ctx.db
        .delete(Agent)
        .where(
          and(
            eq(Agent.id, input),
            eq(Agent.organizationId, ctx.organizationId),
          ),
        );
    }),

  versions: requireRole("Viewer")
    .input(z.object({ agentId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.query.AgentVersion.findMany({
        where: and(
          eq(AgentVersion.agentId, input.agentId),
          eq(AgentVersion.organizationId, ctx.organizationId),
        ),
        orderBy: desc(AgentVersion.version),
      });
    }),

  tools: requireRole("Viewer").query(({ ctx }) => {
    return ctx.db.query.AgentToolDefinition.findMany({
      where: eq(AgentToolDefinition.organizationId, ctx.organizationId),
      orderBy: desc(AgentToolDefinition.createdAt),
    });
  }),

  createTool: requireRole("Manager")
    .input(
      z.object({
        name: z.string().min(2).max(128),
        displayName: z.string().min(2).max(256),
        scope: z.enum(AGENT_TOOL_SCOPES).default("Custom"),
        description: z.string().max(2000).optional(),
        configSchema: z.record(z.string(), z.unknown()).default({}),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [tool] = await ctx.db
        .insert(AgentToolDefinition)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          createdByUserId: ctx.session.user.id,
        })
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "agent_tool.create",
        resourceType: "agent_tool_definition",
        resourceId: tool?.id,
        payload: input,
      });

      return tool;
    }),

  grants: requireRole("Viewer")
    .input(z.object({ agentId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.query.AgentToolGrant.findMany({
        where: and(
          eq(AgentToolGrant.organizationId, ctx.organizationId),
          eq(AgentToolGrant.agentId, input.agentId),
        ),
      });
    }),

  allGrants: requireRole("Viewer").query(({ ctx }) => {
    return ctx.db.query.AgentToolGrant.findMany({
      where: eq(AgentToolGrant.organizationId, ctx.organizationId),
    });
  }),

  revokeAllToolGrants: requireRole("Manager")
    .input(z.object({ toolId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await ctx.db
        .delete(AgentToolGrant)
        .where(
          and(
            eq(AgentToolGrant.organizationId, ctx.organizationId),
            eq(AgentToolGrant.toolId, input.toolId),
          ),
        )
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "agent_tool.revoke_all",
        resourceType: "agent_tool_grant",
        resourceId: input.toolId,
        payload: { revokedCount: revoked.length },
      });

      return { revokedCount: revoked.length };
    }),

  grantTool: requireRole("Manager")
    .input(
      z.object({
        agentId: z.string(),
        toolId: z.string(),
        config: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [grant] = await ctx.db
        .insert(AgentToolGrant)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          grantedByUserId: ctx.session.user.id,
        })
        .onConflictDoUpdate({
          target: [AgentToolGrant.agentId, AgentToolGrant.toolId],
          set: {
            config: input.config,
            grantedByUserId: ctx.session.user.id,
          },
        })
        .returning();

      return grant;
    }),

  revokeTool: requireRole("Manager")
    .input(z.object({ grantId: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.db
        .delete(AgentToolGrant)
        .where(
          and(
            eq(AgentToolGrant.id, input.grantId),
            eq(AgentToolGrant.organizationId, ctx.organizationId),
          ),
        );
    }),

  enqueueRun: requireRole("Member")
    .input(enqueueRunInput)
    .mutation(async ({ ctx, input }) => enqueueRun(ctx, input)),

  run: requireRole("Member")
    .input(enqueueRunInput)
    .mutation(async ({ ctx, input }) => enqueueRun(ctx, input)),

  runs: requireRole("Viewer")
    .input(
      z
        .object({
          agentId: z.string().optional(),
          status: z.enum(AGENT_RUN_STATUSES).optional(),
          limit: z.number().int().min(1).max(100).default(25),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const filters = [eq(AgentRun.organizationId, ctx.organizationId)];

      if (input?.agentId) {
        filters.push(eq(AgentRun.agentId, input.agentId));
      }

      if (input?.status) {
        filters.push(eq(AgentRun.status, input.status));
      }

      return ctx.db.query.AgentRun.findMany({
        where: and(...filters),
        orderBy: desc(AgentRun.createdAt),
        limit: input?.limit ?? 25,
      });
    }),

  runById: requireRole("Viewer")
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.query.AgentRun.findFirst({
        where: and(
          eq(AgentRun.id, input.id),
          eq(AgentRun.organizationId, ctx.organizationId),
        ),
      });
    }),

  cancelRun: requireRole("Member")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.db.query.AgentRun.findFirst({
        where: and(
          eq(AgentRun.id, input.id),
          eq(AgentRun.organizationId, ctx.organizationId),
        ),
      });

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Run not found in this organization.",
        });
      }

      if (
        !canControlRun(ctx.userRole, run.requestedByUserId, ctx.session.user.id)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only cancel your own runs.",
        });
      }

      if (run.status === "Completed" || run.status === "Failed") {
        return run;
      }

      const [cancelled] = await ctx.db
        .update(AgentRun)
        .set({
          status: "Cancelled",
          cancelledAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(AgentRun.id, run.id))
        .returning();

      return cancelled ?? run;
    }),

  pendingApprovals: requireRole("Manager").query(({ ctx }) => {
    return ctx.db.query.AgentRunApproval.findMany({
      where: and(
        eq(AgentRunApproval.organizationId, ctx.organizationId),
        eq(AgentRunApproval.status, "Pending"),
      ),
      orderBy: desc(AgentRunApproval.createdAt),
    });
  }),

  approveRun: requireRole("Manager")
    .input(z.object({ approvalId: z.string(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const approval = await ctx.db.query.AgentRunApproval.findFirst({
        where: and(
          eq(AgentRunApproval.id, input.approvalId),
          eq(AgentRunApproval.organizationId, ctx.organizationId),
        ),
      });

      if (!approval) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Approval request not found.",
        });
      }

      await ctx.db
        .update(AgentRunApproval)
        .set({
          status: "Approved",
          decidedByUserId: ctx.session.user.id,
          decisionNote: input.note,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(AgentRunApproval.id, approval.id));

      const [run] = await ctx.db
        .update(AgentRun)
        .set({
          status: "Queued",
          approvedAt: new Date(),
          runAfter: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(AgentRun.id, approval.agentRunId))
        .returning();

      return run;
    }),

  rejectRun: requireRole("Manager")
    .input(z.object({ approvalId: z.string(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const approval = await ctx.db.query.AgentRunApproval.findFirst({
        where: and(
          eq(AgentRunApproval.id, input.approvalId),
          eq(AgentRunApproval.organizationId, ctx.organizationId),
        ),
      });

      if (!approval) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Approval request not found.",
        });
      }

      await ctx.db
        .update(AgentRunApproval)
        .set({
          status: "Rejected",
          decidedByUserId: ctx.session.user.id,
          decisionNote: input.note,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(AgentRunApproval.id, approval.id));

      const [run] = await ctx.db
        .update(AgentRun)
        .set({
          status: "Cancelled",
          rejectedAt: new Date(),
          cancelledAt: new Date(),
          error: input.note ?? "Run rejected by human approver.",
          updatedAt: new Date(),
        })
        .where(eq(AgentRun.id, approval.agentRunId))
        .returning();

      return run;
    }),

  evaluations: requireRole("Viewer")
    .input(z.object({ agentId: z.string().optional() }).optional())
    .query(({ ctx, input }) => {
      const filters = [eq(AgentEvaluation.organizationId, ctx.organizationId)];
      if (input?.agentId) filters.push(eq(AgentEvaluation.agentId, input.agentId));

      return ctx.db.query.AgentEvaluation.findMany({
        where: and(...filters),
        orderBy: desc(AgentEvaluation.createdAt),
      });
    }),

  createEvaluation: requireRole("Manager")
    .input(
      z.object({
        agentId: z.string(),
        name: z.string().min(2).max(256),
        prompt: z.string().min(1).max(10_000),
        expectedSignals: z.array(z.string()).default([]),
        passThreshold: z.number().min(0).max(1).default(0.8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = await latestAgentVersion(ctx.db, input.agentId);
      const [evaluation] = await ctx.db
        .insert(AgentEvaluation)
        .values({
          ...input,
          organizationId: ctx.organizationId,
          agentVersionId: version?.id,
          createdByUserId: ctx.session.user.id,
        })
        .returning();

      return evaluation;
    }),

  runEvaluation: requireRole("Manager")
    .input(z.object({ evaluationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const evaluation = await ctx.db.query.AgentEvaluation.findFirst({
        where: and(
          eq(AgentEvaluation.id, input.evaluationId),
          eq(AgentEvaluation.organizationId, ctx.organizationId),
        ),
      });

      if (!evaluation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evaluation not found.",
        });
      }

      const run = await enqueueRun(ctx, {
        agentId: evaluation.agentId,
        input: evaluation.prompt,
        idempotencyKey: `eval:${evaluation.id}:${Date.now()}`,
      });

      const [evaluationRun] = await ctx.db
        .insert(AgentEvaluationRun)
        .values({
          organizationId: ctx.organizationId,
          evaluationId: evaluation.id,
          agentRunId: run.id,
          status: "Queued",
        })
        .returning();

      return evaluationRun;
    }),

  evaluationRuns: requireRole("Viewer")
    .input(
      z
        .object({ evaluationId: z.string().optional() })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const filters = [
        eq(AgentEvaluationRun.organizationId, ctx.organizationId),
      ];
      if (input?.evaluationId) {
        filters.push(eq(AgentEvaluationRun.evaluationId, input.evaluationId));
      }
      return ctx.db.query.AgentEvaluationRun.findMany({
        where: and(...filters),
        orderBy: desc(AgentEvaluationRun.createdAt),
        limit: 100,
      });
    }),
} satisfies TRPCRouterRecord;

async function enqueueRun(
  ctx: {
    db: typeof defaultDb;
    organizationId: string;
    session: { user: { id: string } };
  },
  input: z.infer<typeof enqueueRunInput>,
) {
  const entitlement = await canEnqueueRun(ctx.db, ctx.organizationId);
  if (!entitlement.allowed) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: entitlement.reason,
    });
  }

  const agent = await ctx.db.query.Agent.findFirst({
    where: and(
      eq(Agent.id, input.agentId),
      eq(Agent.organizationId, ctx.organizationId),
    ),
  });

  if (!agent) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Agent not found in this organization",
    });
  }

  // Per-agent cost budget: blocking when enforceHardCap is set.
  const budget = await evaluateAgentBudget(ctx.db, ctx.organizationId, agent.id);
  if (!budget.allowed) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: budget.reason,
    });
  }

  const version = await ensureAgentVersion(
    ctx.db,
    agent,
    ctx.session.user.id,
  );
  const requestHash = hashJson({
    agentId: input.agentId,
    input: input.input,
    agentVersionId: version?.id,
  });

  const run = await ctx.db.transaction(async (tx) => {
    const idempotency = input.idempotencyKey
      ? await resolveIdempotencyKey(tx, {
          organizationId: ctx.organizationId,
          userId: ctx.session.user.id,
          key: input.idempotencyKey,
          requestHash,
        })
      : null;

    if (idempotency?.response) {
      const agentRunId = responseAgentRunId(idempotency.response);
      if (agentRunId) {
        const existingRun = await tx.query.AgentRun.findFirst({
          where: and(
            eq(AgentRun.id, agentRunId),
            eq(AgentRun.organizationId, ctx.organizationId),
          ),
        });
        if (existingRun) return existingRun;
      }
    }

    const [created] = await tx
      .insert(AgentRun)
      .values({
        organizationId: ctx.organizationId,
        agentId: input.agentId,
        agentVersionId: version?.id,
        idempotencyKeyId: idempotency?.id,
        requestedByUserId: ctx.session.user.id,
        status: agent.requiresApproval ? "AwaitingApproval" : "Queued",
        input: input.input,
      })
      .returning();

    if (!created) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to enqueue agent run.",
      });
    }

    if (agent.requiresApproval) {
      await tx.insert(AgentRunApproval).values({
        organizationId: ctx.organizationId,
        agentRunId: created.id,
        requestedByUserId: ctx.session.user.id,
        status: "Pending",
        reason: "Agent requires human approval before execution.",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    if (idempotency) {
      await tx
        .update(IdempotencyKey)
        .set({
          response: {
            agentRunId: created.id,
          },
          status: "Completed",
          updatedAt: new Date(),
        })
        .where(eq(IdempotencyKey.id, idempotency.id));
    }

    return created;
  });

  // Returned by the `db.transaction(...)` callback above.
  return run;
}

async function createAgentVersion(
  db: typeof defaultDb,
  agent: typeof Agent.$inferSelect,
  userId: string,
  changeSummary: string,
) {
  const [version] = await db
    .insert(AgentVersion)
    .values({
      organizationId: agent.organizationId,
      agentId: agent.id,
      version: agent.latestVersion,
      type: agent.type,
      modelProvider: agent.modelProvider,
      modelName: agent.modelName,
      baseUrl: agent.baseUrl,
      apiKeyEncrypted: agent.apiKeyEncrypted,
      costPer1kTokens: agent.costPer1kTokens,
      systemPrompt: agent.systemPrompt,
      toolMode: agent.toolMode,
      requiresApproval: agent.requiresApproval,
      changeSummary,
      createdByUserId: userId,
    })
    .onConflictDoNothing()
    .returning();

  return version ?? latestAgentVersion(db, agent.id);
}

async function ensureAgentVersion(
  db: typeof defaultDb,
  agent: typeof Agent.$inferSelect,
  userId: string,
) {
  const existing = await latestAgentVersion(db, agent.id);
  if (existing) return existing;

  return createAgentVersion(db, agent, userId, "Backfilled runtime version");
}

function latestAgentVersion(db: typeof defaultDb, agentId: string) {
  return db.query.AgentVersion.findFirst({
    where: eq(AgentVersion.agentId, agentId),
    orderBy: desc(AgentVersion.version),
  });
}

async function resolveIdempotencyKey(
  db: AgentDbClient,
  input: {
    organizationId: string;
    userId: string;
    key: string;
    requestHash: string;
  },
) {
  const existing = await db.query.IdempotencyKey.findFirst({
    where: and(
      eq(IdempotencyKey.organizationId, input.organizationId),
      eq(IdempotencyKey.scope, "agent.enqueueRun"),
      eq(IdempotencyKey.key, input.key),
    ),
  });

  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Idempotency key was already used for a different request.",
      });
    }
    return existing;
  }

  const [created] = await db
    .insert(IdempotencyKey)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      scope: "agent.enqueueRun",
      key: input.key,
      requestHash: input.requestHash,
      status: "Started",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();

  return created ?? null;
}

function responseAgentRunId(response: unknown) {
  return typeof response === "object" &&
    response !== null &&
    typeof (response as { agentRunId?: unknown }).agentRunId === "string"
    ? (response as { agentRunId: string }).agentRunId
    : null;
}

function hashJson(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function changesVersionedRuntime(input: Record<string, unknown>) {
  return [
    "type",
    "modelProvider",
    "modelName",
    "systemPrompt",
    "requiresApproval",
    "toolMode",
    "costPer1kTokens",
  ].some((key) => key in input);
}

function canControlRun(
  userRole: (typeof ORGANIZATION_ROLES)[number],
  requestedByUserId: string,
  currentUserId: string,
) {
  if (requestedByUserId === currentUserId) return true;

  return (
    ORGANIZATION_ROLES.indexOf(userRole) <=
    ORGANIZATION_ROLES.indexOf("Manager")
  );
}
