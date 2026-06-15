import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { investigateSessionWithSplunk } from "@agentscope/agents";
import { and, asc, desc, eq } from "@agentscope/db";
import { Agent, Event, Session } from "@agentscope/db/schema";

import { orgProcedure } from "../trpc";

export const sessionRouter = {
  all: orgProcedure.query(({ ctx }) => {
    return ctx.db.query.Session.findMany({
      where: eq(Session.organizationId, ctx.organizationId),
      orderBy: desc(Session.createdAt),
      limit: 50,
    });
  }),

  byAgent: orgProcedure
    .input(z.object({ agentId: z.string() }))
    .query(({ ctx, input }) => {
      return ctx.db.query.Session.findMany({
        where: and(
          eq(Session.agentId, input.agentId),
          eq(Session.organizationId, ctx.organizationId),
        ),
        orderBy: desc(Session.createdAt),
        limit: 50,
      });
    }),



  /** Get the event timeline for a session (session replay) */
  replay: orgProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.Session.findFirst({
        where: and(
          eq(Session.id, input.sessionId),
          eq(Session.organizationId, ctx.organizationId),
        ),
      });

      if (!session) {
        return { session: null, events: [] };
      }

      const events = await ctx.db.query.Event.findMany({
        where: eq(Event.sessionId, input.sessionId),
        orderBy: asc(Event.createdAt),
      });

      return { session, events };
    }),

  create: orgProcedure
    .input(
      z.object({
        agentId: z.string(),
        input: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.db.insert(Session).values({
        ...input,
        organizationId: ctx.organizationId,
        input: input.input ?? "",
      });
    }),

  investigate: orgProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.Session.findFirst({
        where: and(
          eq(Session.id, input.sessionId),
          eq(Session.organizationId, ctx.organizationId),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found in this organization",
        });
      }

      const agent = await ctx.db.query.Agent.findFirst({
        where: and(
          eq(Agent.id, session.agentId),
          eq(Agent.organizationId, ctx.organizationId),
        ),
      });

      return investigateSessionWithSplunk({
        sessionId: session.id,
        task: session.input ?? "Untitled task",
        agentName: agent?.name ?? session.agentId,
        output: session.output,
      });
    }),
} satisfies TRPCRouterRecord;
