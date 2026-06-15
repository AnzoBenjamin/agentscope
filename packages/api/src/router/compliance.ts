import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { db as defaultDb } from "@agentscope/db/client";
import { desc, eq, inArray, sql } from "@agentscope/db";
import {
  AgentRun,
  AuditLog,
  COMPLIANCE_EXPORT_TYPES,
  ComplianceEvidence,
  ComplianceExport,
  ComplianceLegalHold,
  CompliancePolicy,
  ComplianceRetentionJob,
  Cost,
  Event,
  Session,
} from "@agentscope/db/schema";

import { writeAuditLog } from "../audit";
import { requireRole } from "../trpc";

export const updatePolicyInputSchema = z.object({
  retentionDays: z.number().int().min(30).max(3650),
  requireSplunkEvidence: z.boolean(),
  redactSensitivePayloads: z.boolean(),
  allowAuditExports: z.boolean(),
  immutableAudit: z.boolean(),
  enforceRetention: z.boolean(),
  exportRequiresApproval: z.boolean(),
  piiRedactionMode: z.enum(["Off", "Basic", "Strict"]),
});

export type UpdatePolicyInput = z.infer<typeof updatePolicyInputSchema>;

export const complianceRouter = {
  policy: requireRole("Viewer").query(async ({ ctx }) => {
    const policy = await ctx.db.query.CompliancePolicy.findFirst({
      where: eq(CompliancePolicy.organizationId, ctx.organizationId),
    });

    if (policy) return policy;

    const [created] = await ctx.db
      .insert(CompliancePolicy)
      .values({ organizationId: ctx.organizationId })
      .returning();

    return created;
  }),

  updatePolicy: requireRole("Admin")
    .input(updatePolicyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [policy] = await ctx.db
        .insert(CompliancePolicy)
        .values({
          organizationId: ctx.organizationId,
          ...input,
        })
        .onConflictDoUpdate({
          target: CompliancePolicy.organizationId,
          set: {
            ...input,
            updatedAt: new Date(),
          },
        })
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "compliance.policy_update",
        resourceType: "compliance_policy",
        resourceId: policy?.id,
        payload: input,
      });

      return policy;
    }),

  auditLogs: requireRole("Viewer")
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(100),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return ctx.db.query.AuditLog.findMany({
        where: eq(AuditLog.organizationId, ctx.organizationId),
        orderBy: desc(AuditLog.createdAt),
        limit: input?.limit ?? 100,
      });
    }),

  verifyAuditChain: requireRole("Admin").query(async ({ ctx }) => {
    const logs = await ctx.db.query.AuditLog.findMany({
      where: eq(AuditLog.organizationId, ctx.organizationId),
      orderBy: desc(AuditLog.sequence),
      limit: 1000,
    });

    const ordered = [...logs].reverse();
    const broken = ordered.find((log, index) => {
      if (index === 0) return log.sequence !== 1;
      return log.previousHash !== ordered[index - 1]?.payloadHash;
    });

    return {
      checked: ordered.length,
      valid: !broken,
      brokenAt: broken?.id ?? null,
    };
  }),

  legalHolds: requireRole("Viewer").query(({ ctx }) => {
    return ctx.db.query.ComplianceLegalHold.findMany({
      where: eq(ComplianceLegalHold.organizationId, ctx.organizationId),
      orderBy: desc(ComplianceLegalHold.createdAt),
    });
  }),

  createLegalHold: requireRole("Admin")
    .input(
      z.object({
        name: z.string().min(2).max(256),
        reason: z.string().min(2).max(4000),
        scope: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [hold] = await ctx.db
        .insert(ComplianceLegalHold)
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
        action: "compliance.legal_hold_create",
        resourceType: "compliance_legal_hold",
        resourceId: hold?.id,
        payload: input,
      });

      return hold;
    }),

  releaseLegalHold: requireRole("Admin")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [hold] = await ctx.db
        .update(ComplianceLegalHold)
        .set({
          active: false,
          releasedByUserId: ctx.session.user.id,
          releasedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(sql`${ComplianceLegalHold.id} = ${input.id}
          and ${ComplianceLegalHold.organizationId} = ${ctx.organizationId}`)
        .returning();

      return hold;
    }),

  evidence: requireRole("Viewer")
    .input(
      z
        .object({
          resourceType: z.string().optional(),
          resourceId: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      return ctx.db.query.ComplianceEvidence.findMany({
        where: sql`${ComplianceEvidence.organizationId} = ${ctx.organizationId}
          ${input?.resourceType ? sql`and ${ComplianceEvidence.resourceType} = ${input.resourceType}` : sql``}
          ${input?.resourceId ? sql`and ${ComplianceEvidence.resourceId} = ${input.resourceId}` : sql``}`,
        orderBy: desc(ComplianceEvidence.createdAt),
        limit: 100,
      });
    }),

  exports: requireRole("Viewer").query(({ ctx }) => {
    return ctx.db.query.ComplianceExport.findMany({
      where: eq(ComplianceExport.organizationId, ctx.organizationId),
      orderBy: desc(ComplianceExport.createdAt),
      limit: 25,
    });
  }),

  createExport: requireRole("Admin")
    .input(
      z.object({
        exportType: z.enum(COMPLIANCE_EXPORT_TYPES),
        fileFormat: z.enum(["csv", "json"]).default("csv"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const policy = await ctx.db.query.CompliancePolicy.findFirst({
        where: eq(CompliancePolicy.organizationId, ctx.organizationId),
      });

      if (policy?.allowAuditExports === false) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Audit exports are disabled by compliance policy.",
        });
      }

      const rows = await exportRows(ctx, input.exportType);
      const exportRowsForPolicy =
        policy?.redactSensitivePayloads === false ? rows : redactRows(rows);
      const content =
        input.fileFormat === "json"
          ? JSON.stringify(exportRowsForPolicy, null, 2)
          : toCsv(exportRowsForPolicy);
      const [created] = await ctx.db
        .insert(ComplianceExport)
        .values({
          organizationId: ctx.organizationId,
          requestedByUserId: ctx.session.user.id,
          exportType: input.exportType,
          fileFormat: input.fileFormat,
          status: policy?.exportRequiresApproval
            ? "PendingApproval"
            : "Completed",
          filters: {},
          content,
        })
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "compliance.export_create",
        resourceType: "compliance_export",
        resourceId: created?.id,
        payload: {
          exportType: input.exportType,
          fileFormat: input.fileFormat,
          rowCount: rows.length,
        },
      });

      return created;
    }),

  approveExport: requireRole("Admin")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [approved] = await ctx.db
        .update(ComplianceExport)
        .set({
          status: "Completed",
          approvedByUserId: ctx.session.user.id,
          approvedAt: new Date(),
        })
        .where(sql`${ComplianceExport.id} = ${input.id}
          and ${ComplianceExport.organizationId} = ${ctx.organizationId}`)
        .returning();

      return approved;
    }),

  retentionJobs: requireRole("Viewer").query(({ ctx }) => {
    return ctx.db.query.ComplianceRetentionJob.findMany({
      where: eq(ComplianceRetentionJob.organizationId, ctx.organizationId),
      orderBy: desc(ComplianceRetentionJob.createdAt),
      limit: 25,
    });
  }),

  runRetentionJob: requireRole("Admin").mutation(async ({ ctx }) => {
    const policy = await ctx.db.query.CompliancePolicy.findFirst({
      where: eq(CompliancePolicy.organizationId, ctx.organizationId),
    });
    const retentionDays = policy?.retentionDays ?? 365;

    if (policy?.enforceRetention === false) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Retention enforcement is disabled by policy.",
      });
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const [job] = await ctx.db
      .insert(ComplianceRetentionJob)
      .values({
        organizationId: ctx.organizationId,
        requestedByUserId: ctx.session.user.id,
        retentionDays,
        status: "Running",
        startedAt: new Date(),
      })
      .returning();

    if (!job) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create retention job.",
      });
    }

    const legalHold = await ctx.db.query.ComplianceLegalHold.findFirst({
      where: sql`${ComplianceLegalHold.organizationId} = ${ctx.organizationId}
        and ${ComplianceLegalHold.active} = true`,
    });

    const oldSessions = await ctx.db.query.Session.findMany({
      where: sql`${Session.organizationId} = ${ctx.organizationId}
        and ${Session.createdAt} <= ${cutoff}`,
      columns: { id: true },
      limit: 1000,
    });

    if (legalHold) {
      const [updated] = await ctx.db
        .update(ComplianceRetentionJob)
        .set({
          status: "Completed",
          skippedByLegalHold: oldSessions.length,
          completedAt: new Date(),
        })
        .where(eq(ComplianceRetentionJob.id, job.id))
        .returning();

      return updated;
    }

    const sessionIds = oldSessions.map((session) => session.id);
    const deletedEvents =
      sessionIds.length === 0
        ? []
        : await ctx.db
            .delete(Event)
            .where(inArray(Event.sessionId, sessionIds))
            .returning();
    const deletedSessions =
      sessionIds.length === 0
        ? []
        : await ctx.db
            .delete(Session)
            .where(inArray(Session.id, sessionIds))
            .returning();

    const [updated] = await ctx.db
      .update(ComplianceRetentionJob)
      .set({
        status: "Completed",
        deletedEvents: deletedEvents.length,
        deletedSessions: deletedSessions.length,
        completedAt: new Date(),
      })
      .where(eq(ComplianceRetentionJob.id, job.id))
      .returning();

    return updated;
  }),
} satisfies TRPCRouterRecord;

async function exportRows(
  ctx: {
    db: typeof defaultDb;
    organizationId: string;
  },
  exportType: (typeof COMPLIANCE_EXPORT_TYPES)[number],
) {
  if (exportType === "AuditLog") {
    return ctx.db.query.AuditLog.findMany({
      where: eq(AuditLog.organizationId, ctx.organizationId),
      orderBy: desc(AuditLog.createdAt),
      limit: 1000,
    });
  }

  if (exportType === "Runs") {
    return ctx.db.query.AgentRun.findMany({
      where: eq(AgentRun.organizationId, ctx.organizationId),
      orderBy: desc(AgentRun.createdAt),
      limit: 1000,
    });
  }

  if (exportType === "Sessions") {
    return ctx.db.query.Session.findMany({
      where: eq(Session.organizationId, ctx.organizationId),
      orderBy: desc(Session.createdAt),
      limit: 1000,
    });
  }

  const sessions = await ctx.db.query.Session.findMany({
    where: eq(Session.organizationId, ctx.organizationId),
    columns: { id: true },
    limit: 1000,
  });
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length === 0) return [];

  return ctx.db.query.Cost.findMany({
    where: inArray(Cost.sessionId, sessionIds),
    orderBy: desc(Cost.createdAt),
    limit: 1000,
  });
}

function toCsv(rows: unknown[]) {
  if (rows.length === 0) return "";

  const records = rows.map((row) => flatten(row as Record<string, unknown>));
  const headers = Array.from(
    records.reduce((keys, record) => {
      Object.keys(record).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );

  return [
    headers.join(","),
    ...records.map((record) =>
      headers.map((header) => csvValue(record[header])).join(","),
    ),
  ].join("\n");
}

function flatten(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date
        ? value.toISOString()
        : typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value,
    ]),
  );
}

function csvValue(value: unknown) {
  let text = "";

  if (typeof value === "string") {
    text = value;
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    text = String(value);
  } else if (value instanceof Date) {
    text = value.toISOString();
  } else if (value !== undefined && value !== null) {
    text = JSON.stringify(value);
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function redactRows(rows: unknown[]) {
  return rows.map((row) => redactValue(row));
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
      /token|secret|password|authorization|api[-_]?key|credential/i.test(key)
        ? "[redacted]"
        : redactValue(nested),
    ]),
  );
}
