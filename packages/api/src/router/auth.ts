import { randomBytes } from "node:crypto";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import type { db as defaultDb } from "@agentscope/db/client";
import { and, desc, eq } from "@agentscope/db";
import {
  Agent,
  AgentToolDefinition,
  AgentVersion,
  AuditLog,
  user as AuthUser,
  CompliancePolicy,
  Organization,
  ORGANIZATION_ROLES,
  OrganizationInvite,
  OrganizationMember,
  OrganizationSubscription,
  SecurityPolicy,
} from "@agentscope/db/schema";

import { writeAuditLog } from "../audit";
import { sendOrganizationInviteEmail } from "../email/resend";
import { protectedProcedure, requireRole } from "../trpc";
import { hasAnotherActiveOwner } from "./auth-policy";

const roleSchema = z.enum(ORGANIZATION_ROLES);

export const authRouter = {
  me: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.query.OrganizationMember.findMany({
      where: and(
        eq(OrganizationMember.userId, ctx.session.user.id),
        eq(OrganizationMember.status, "Active"),
      ),
      orderBy: desc(OrganizationMember.createdAt),
    });

    const organizations = await Promise.all(
      memberships.map(async (membership) => {
        const organization = await ctx.db.query.Organization.findFirst({
          where: eq(Organization.id, membership.organizationId),
        });

        return organization
          ? {
              membership,
              organization,
            }
          : null;
      }),
    );

    return {
      session: ctx.session,
      activeMembership: ctx.membership,
      organizations: organizations.filter((item) => item !== null),
    };
  }),

  createOrganization: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(256),
        slug: z
          .string()
          .trim()
          .min(2)
          .max(128)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const slug = input.slug ?? slugify(input.name);
      const existing = await ctx.db.query.Organization.findFirst({
        where: eq(Organization.slug, slug),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Organization slug is already in use.",
        });
      }

      return ctx.db.transaction(async (tx) => {
        const [organization] = await tx
          .insert(Organization)
          .values({
            name: input.name,
            slug,
            plan: "Starter",
          })
          .returning();

        if (!organization) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create organization.",
          });
        }

        await tx.insert(OrganizationMember).values({
          organizationId: organization.id,
          userId: ctx.session.user.id,
          role: "Owner",
          status: "Active",
        });

        await tx.insert(OrganizationSubscription).values({
          organizationId: organization.id,
          plan: "Starter",
          status: "Trialing",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        });

        await tx.insert(CompliancePolicy).values({
          organizationId: organization.id,
        });

        await tx.insert(SecurityPolicy).values({
          organizationId: organization.id,
        });

        const agents = await tx
          .insert(Agent)
          .values(defaultAgents(organization.id))
          .returning();

        await tx.insert(AgentVersion).values(
          agents.map((agent) => ({
            organizationId: organization.id,
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
            changeSummary: "Created with organization defaults",
            createdByUserId: ctx.session.user.id,
          })),
        );

        await tx.insert(AgentToolDefinition).values(
          defaultTools(organization.id, ctx.session.user.id),
        );

        await tx.insert(AuditLog).values({
          organizationId: organization.id,
          actorUserId: ctx.session.user.id,
          action: "organization.create",
          resourceType: "organization",
          resourceId: organization.id,
          payload: {
            name: organization.name,
            slug: organization.slug,
          },
        });

        return organization;
      });
    }),

  members: requireRole("Viewer").query(async ({ ctx }) => {
    const members = await ctx.db.query.OrganizationMember.findMany({
      where: eq(OrganizationMember.organizationId, ctx.organizationId),
      orderBy: desc(OrganizationMember.createdAt),
    });

    return Promise.all(
      members.map(async (membership) => {
        const user = await ctx.db.query.user.findFirst({
          where: eq(AuthUser.id, membership.userId),
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        });

        return {
          membership,
          user,
        };
      }),
    );
  }),

  invites: requireRole("Admin").query(({ ctx }) => {
    return ctx.db.query.OrganizationInvite.findMany({
      where: eq(OrganizationInvite.organizationId, ctx.organizationId),
      orderBy: desc(OrganizationInvite.createdAt),
    });
  }),

  inviteMember: requireRole("Admin")
    .input(
      z.object({
        email: z.email().max(320),
        role: roleSchema.default("Member"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.role === "Owner" && ctx.userRole !== "Owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only owners can invite another owner.",
        });
      }

      const organization = await ctx.db.query.Organization.findFirst({
        where: eq(Organization.id, ctx.organizationId),
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found.",
        });
      }

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const [invite] = await ctx.db
        .insert(OrganizationInvite)
        .values({
          organizationId: ctx.organizationId,
          email: input.email.toLowerCase(),
          role: input.role,
          token,
          status: "Pending",
          invitedByUserId: ctx.session.user.id,
          expiresAt,
        })
        .returning();

      if (!invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create invite.",
        });
      }

      try {
        await sendOrganizationInviteEmail({
          to: invite.email,
          organizationName: organization.name,
          invitedByName: ctx.session.user.name,
          role: invite.role,
          token,
        });
      } catch (error) {
        await ctx.db
          .update(OrganizationInvite)
          .set({
            status: "Revoked",
            updatedAt: new Date(),
          })
          .where(eq(OrganizationInvite.id, invite.id));

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to send invite email.",
          cause: error,
        });
      }

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "member.invite",
        resourceType: "organization_invite",
        resourceId: invite.id,
        payload: {
          email: invite.email,
          role: invite.role,
        },
      });

      return invite;
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string().min(16) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.query.OrganizationInvite.findFirst({
        where: and(
          eq(OrganizationInvite.token, input.token),
          eq(OrganizationInvite.status, "Pending"),
        ),
      });

      if (!invite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite not found or already used.",
        });
      }

      if (invite.email.toLowerCase() !== ctx.session.user.email.toLowerCase()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This invite was sent to a different email address.",
        });
      }

      if (invite.expiresAt.getTime() <= Date.now()) {
        await ctx.db
          .update(OrganizationInvite)
          .set({
            status: "Expired",
            updatedAt: new Date(),
          })
          .where(eq(OrganizationInvite.id, invite.id));

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invite has expired.",
        });
      }

      return ctx.db.transaction(async (tx) => {
        const existingMember = await tx.query.OrganizationMember.findFirst({
          where: and(
            eq(OrganizationMember.organizationId, invite.organizationId),
            eq(OrganizationMember.userId, ctx.session.user.id),
          ),
        });

        if (existingMember) {
          await tx
            .update(OrganizationMember)
            .set({
              role: invite.role,
              status: "Active",
              updatedAt: new Date(),
            })
            .where(eq(OrganizationMember.id, existingMember.id));
        } else {
          await tx.insert(OrganizationMember).values({
            organizationId: invite.organizationId,
            userId: ctx.session.user.id,
            role: invite.role,
            status: "Active",
          });
        }

        const [acceptedInvite] = await tx
          .update(OrganizationInvite)
          .set({
            status: "Accepted",
            acceptedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(OrganizationInvite.id, invite.id))
          .returning();

        await tx.insert(AuditLog).values({
          organizationId: invite.organizationId,
          actorUserId: ctx.session.user.id,
          action: "member.accept_invite",
          resourceType: "organization_invite",
          resourceId: invite.id,
          payload: {
            role: invite.role,
          },
        });

        return acceptedInvite;
      });
    }),

  revokeInvite: requireRole("Admin")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [invite] = await ctx.db
        .update(OrganizationInvite)
        .set({
          status: "Revoked",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(OrganizationInvite.id, input.id),
            eq(OrganizationInvite.organizationId, ctx.organizationId),
          ),
        )
        .returning();

      if (invite) {
        await writeAuditLog({
          db: ctx.db,
          organizationId: ctx.organizationId,
          actorUserId: ctx.session.user.id,
          action: "member.revoke_invite",
          resourceType: "organization_invite",
          resourceId: invite.id,
          payload: {
            email: invite.email,
            role: invite.role,
          },
        });
      }

      return invite;
    }),

  updateMemberRole: requireRole("Admin")
    .input(
      z.object({
        memberId: z.string(),
        role: roleSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.role === "Owner" && ctx.userRole !== "Owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only owners can promote another owner.",
        });
      }

      const member = await ctx.db.query.OrganizationMember.findFirst({
        where: and(
          eq(OrganizationMember.id, input.memberId),
          eq(OrganizationMember.organizationId, ctx.organizationId),
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      }

      if (member.role === "Owner" && input.role !== "Owner") {
        await assertAnotherOwner(ctx.db, ctx.organizationId, member.id);
      }

      const [updated] = await ctx.db
        .update(OrganizationMember)
        .set({
          role: input.role,
          updatedAt: new Date(),
        })
        .where(eq(OrganizationMember.id, member.id))
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "member.update_role",
        resourceType: "organization_member",
        resourceId: member.id,
        payload: {
          previousRole: member.role,
          role: input.role,
        },
      });

      return updated;
    }),

  removeMember: requireRole("Admin")
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.db.query.OrganizationMember.findFirst({
        where: and(
          eq(OrganizationMember.id, input.memberId),
          eq(OrganizationMember.organizationId, ctx.organizationId),
        ),
      });

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found.",
        });
      }

      if (member.role === "Owner") {
        await assertAnotherOwner(ctx.db, ctx.organizationId, member.id);
      }

      const [removed] = await ctx.db
        .update(OrganizationMember)
        .set({
          status: "Disabled",
          updatedAt: new Date(),
        })
        .where(eq(OrganizationMember.id, member.id))
        .returning();

      await writeAuditLog({
        db: ctx.db,
        organizationId: ctx.organizationId,
        actorUserId: ctx.session.user.id,
        action: "member.remove",
        resourceType: "organization_member",
        resourceId: member.id,
        payload: {
          role: member.role,
        },
      });

      return removed;
    }),
} satisfies TRPCRouterRecord;

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);

  return slug || `org-${randomBytes(4).toString("hex")}`;
}

function defaultAgents(organizationId: string) {
  return [
    {
      organizationId,
      name: "Research Agent",
      type: "Research",
      description:
        "Investigates operational questions using Splunk evidence and produces audit-ready reports.",
      modelProvider: "OpenAI",
      modelName: "gpt-4o",
      status: "Active",
      requiresApproval: false,
      costPer1kTokens: 0.03,
      systemPrompt:
        "You are an AI operations analyst. Use Splunk evidence to explain reliability, cost, and tool-use signals.",
    },
    {
      organizationId,
      name: "Reliability Agent",
      type: "Reliability",
      description:
        "Reviews failure, latency, and retry signals for AI employee sessions.",
      modelProvider: "OpenAI",
      modelName: "gpt-4o-mini",
      status: "Active",
      requiresApproval: false,
      costPer1kTokens: 0.01,
      systemPrompt:
        "You are an SRE for AI agents. Find reliability risks using telemetry and recommend mitigations.",
    },
    {
      organizationId,
      name: "Cost Analyst Agent",
      type: "CostAnalyst",
      description:
        "Analyzes token spend, model selection, and agent utilization trends.",
      modelProvider: "OpenAI",
      modelName: "gpt-4o-mini",
      status: "Active",
      requiresApproval: false,
      costPer1kTokens: 0.01,
      systemPrompt:
        "You are a FinOps analyst for AI systems. Attribute model cost and recommend controls.",
    },
  ];
}

function defaultTools(organizationId: string, createdByUserId: string) {
  return [
    {
      organizationId,
      name: "splunk-context-search",
      displayName: "Splunk Context Search",
      scope: "SearchSplunk",
      description: "Searches Splunk MCP for AgentScope operational events.",
      configSchema: {
        query: "string",
      },
      createdByUserId,
    },
    {
      organizationId,
      name: "read-telemetry",
      displayName: "Read Telemetry",
      scope: "ReadTelemetry",
      description: "Reads AgentScope session, cost, and event telemetry.",
      configSchema: {},
      createdByUserId,
    },
  ];
}

async function assertAnotherOwner(
  db: typeof defaultDb,
  organizationId: string,
  memberId: string,
) {
  const owners = await db.query.OrganizationMember.findMany({
    where: and(
      eq(OrganizationMember.organizationId, organizationId),
      eq(OrganizationMember.status, "Active"),
      eq(OrganizationMember.role, "Owner"),
    ),
  });

  if (!hasAnotherActiveOwner(owners, memberId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An organization must keep at least one active owner.",
    });
  }
}
