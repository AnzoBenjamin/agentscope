import { createHash, randomBytes } from "node:crypto";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq } from "@agentscope/db";
import type { db as defaultDb } from "@agentscope/db/client";
import {
  ApiKey,
  IDENTITY_PROVIDER_TYPES,
  IdentityProvider,
  ScimToken,
  SecurityPolicy,
} from "@agentscope/db/schema";

import { writeAuditLog } from "../audit";
import { requireRole } from "../trpc";

const scopeSchema = z.array(z.string().min(1).max(128)).max(50).default([]);

export const securityRouter = {
  policy: requireRole("Admin").query(async ({ ctx }) => {
    return ensureSecurityPolicy(ctx.db, ctx.organizationId);
  }),

  updatePolicy: requireRole("Owner")
    .input(
      z.object({
        apiKeysEnabled: z.boolean(),
        ssoRequired: z.boolean(),
        scimRequired: z.boolean(),
        defaultRateLimitPerMinute: z.number().int().min(10).max(10_000),
        allowedEmailDomains: z.array(z.string().min(2)).max(100).default([]),
        sessionTtlMinutes: z.number().int().min(15).max(43_200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [policy] = await ctx.db
        .insert(SecurityPolicy)
        .values({
          organizationId: ctx.organizationId,
          ...input,
        })
        .onConflictDoUpdate({
          target: SecurityPolicy.organizationId,
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
        action: "security.policy_update",
        resourceType: "security_policy",
        resourceId: policy?.id,
        payload: input,
      });

      return policy;
    }),

  apiKeys: requireRole("Admin").query(({ ctx }) => {
    return ctx.db.query.ApiKey.findMany({
      where: eq(ApiKey.organizationId, ctx.organizationId),
      orderBy: desc(ApiKey.createdAt),
      columns: {
        id: true,
        organizationId: true,
        name: true,
        prefix: true,
        scopes: true,
        status: true,
        createdByUserId: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }),

  createApiKey: requireRole("Admin")
    .input(
      z.object({
        name: z.string().min(2).max(256),
        scopes: scopeSchema,
        expiresAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const policy = await ensureSecurityPolicy(ctx.db, ctx.organizationId);
      if (!policy?.apiKeysEnabled) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "API keys are disabled by security policy.",
        });
      }

      const secret = `ags_${randomBytes(32).toString("base64url")}`;
      const prefix = secret.slice(0, 12);
      const [apiKey] = await ctx.db
        .insert(ApiKey)
        .values({
          organizationId: ctx.organizationId,
          name: input.name,
          keyHash: hashSecret(secret),
          prefix,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
          createdByUserId: ctx.session.user.id,
        })
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "security.api_key_create",
        resourceType: "api_key",
        resourceId: apiKey?.id,
        payload: {
          name: input.name,
          prefix,
          scopes: input.scopes,
        },
      });

      return {
        apiKey,
        secret,
      };
    }),

  revokeApiKey: requireRole("Admin")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [apiKey] = await ctx.db
        .update(ApiKey)
        .set({
          status: "Revoked",
          revokedAt: new Date(),
        })
        .where(
          and(
            eq(ApiKey.id, input.id),
            eq(ApiKey.organizationId, ctx.organizationId),
          ),
        )
        .returning();

      return apiKey;
    }),

  identityProviders: requireRole("Admin").query(({ ctx }) => {
    return ctx.db.query.IdentityProvider.findMany({
      where: eq(IdentityProvider.organizationId, ctx.organizationId),
      orderBy: desc(IdentityProvider.createdAt),
    });
  }),

  upsertIdentityProvider: requireRole("Owner")
    .input(
      z.object({
        id: z.string().optional(),
        type: z.enum(IDENTITY_PROVIDER_TYPES),
        name: z.string().min(2).max(256),
        issuer: z.string().min(2),
        ssoUrl: z.string().optional(),
        certificate: z.string().optional(),
        clientId: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).default({}),
        enabled: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const [provider] = await ctx.db
          .update(IdentityProvider)
          .set({
            type: input.type,
            name: input.name,
            issuer: input.issuer,
            ssoUrl: input.ssoUrl,
            certificate: input.certificate,
            clientId: input.clientId,
            metadata: input.metadata,
            enabled: input.enabled,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(IdentityProvider.id, input.id),
              eq(IdentityProvider.organizationId, ctx.organizationId),
            ),
          )
          .returning();
        return provider;
      }

      const [provider] = await ctx.db
        .insert(IdentityProvider)
        .values({
          organizationId: ctx.organizationId,
          type: input.type,
          name: input.name,
          issuer: input.issuer,
          ssoUrl: input.ssoUrl,
          certificate: input.certificate,
          clientId: input.clientId,
          metadata: input.metadata,
          enabled: input.enabled,
        })
        .returning();

      return provider;
    }),

  scimTokens: requireRole("Admin").query(({ ctx }) => {
    return ctx.db.query.ScimToken.findMany({
      where: eq(ScimToken.organizationId, ctx.organizationId),
      orderBy: desc(ScimToken.createdAt),
      columns: {
        id: true,
        organizationId: true,
        prefix: true,
        status: true,
        createdByUserId: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }),

  createScimToken: requireRole("Owner")
    .input(z.object({ expiresAt: z.date().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const secret = `scim_${randomBytes(32).toString("base64url")}`;
      const prefix = secret.slice(0, 12);
      const [token] = await ctx.db
        .insert(ScimToken)
        .values({
          organizationId: ctx.organizationId,
          tokenHash: hashSecret(secret),
          prefix,
          expiresAt: input?.expiresAt,
          createdByUserId: ctx.session.user.id,
        })
        .returning();

      return {
        token,
        secret,
      };
    }),

  revokeScimToken: requireRole("Owner")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [token] = await ctx.db
        .update(ScimToken)
        .set({
          status: "Revoked",
          revokedAt: new Date(),
        })
        .where(
          and(
            eq(ScimToken.id, input.id),
            eq(ScimToken.organizationId, ctx.organizationId),
          ),
        )
        .returning();

      return token;
    }),
} satisfies TRPCRouterRecord;

async function ensureSecurityPolicy(
  db: typeof defaultDb,
  organizationId: string,
) {
  const existing = await db.query.SecurityPolicy.findFirst({
    where: eq(SecurityPolicy.organizationId, organizationId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(SecurityPolicy)
    .values({ organizationId })
    .onConflictDoUpdate({
      target: SecurityPolicy.organizationId,
      set: { updatedAt: new Date() },
    })
    .returning();

  return created;
}

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}
