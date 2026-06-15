/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1)
 * 2. You want to create a new middleware or type of procedure (see Part 3)
 *
 * tl;dr - this is where all the tRPC server stuff is created and plugged in.
 * The pieces you will need to use are documented accordingly near the end
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod/v4";

import type { Auth } from "@agentscope/auth";
import { and, desc, eq, sql } from "@agentscope/db";
import { db } from "@agentscope/db/client";
import {
  ORGANIZATION_ROLES,
  OrganizationMember,
  SecurityPolicy,
} from "@agentscope/db/schema";
import { createLogger, rateLimitRejectionsTotal } from "@agentscope/observability";

const trpcLogger = createLogger("api.trpc");

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */

export const createTRPCContext = async (opts: {
  headers: Headers;
  auth: Auth;
}) => {
  const authApi = opts.auth.api;
  const session = await authApi.getSession({
    headers: opts.headers,
  });
  const requestedOrganizationId = opts.headers.get(
    "x-agentscope-organization-id",
  );
  const membership = session?.user
    ? await db.query.OrganizationMember.findFirst({
        where: requestedOrganizationId
          ? and(
              eq(OrganizationMember.userId, session.user.id),
              eq(OrganizationMember.status, "Active"),
              eq(OrganizationMember.organizationId, requestedOrganizationId),
            )
          : and(
              eq(OrganizationMember.userId, session.user.id),
              eq(OrganizationMember.status, "Active"),
            ),
        orderBy: desc(OrganizationMember.createdAt),
      })
    : null;

  return {
    authApi,
    session,
    membership,
    db,
  };
};
/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError
          ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
          : null,
    },
  }),
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/** Middleware for timing procedure execution. */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  const result = await next();

  const end = Date.now();
  trpcLogger.debug({ path, durationMs: end - start }, "trpc procedure completed");

  return result;
});

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        // infers the `session` as non-nullable
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

// ─── Role-Based Access Control ───────────────────────────────────────

type Role = (typeof ORGANIZATION_ROLES)[number];

/**
 * Role-protected procedure — enforces minimum role level.
 *
 * `requireRole("Admin")` — only Owner and Admin can access.
 * `requireRole("Viewer")` — any authenticated user can access.
 */
/**
 * Organization-scoped procedure — filters queries by organization.
 * Requires that the user has an active database-backed membership.
 */
export const orgProcedure = protectedProcedure.use(async ({ ctx, next, path }) => {
  if (!ctx.membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Create or join an organization before using AgentScope.",
    });
  }

  await enforceRateLimit({
    organizationId: ctx.membership.organizationId,
    subject: ctx.session.user.id,
    route: path,
  });

  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
      membership: ctx.membership,
      organizationId: ctx.membership.organizationId,
    },
  });
});

/**
 * Role-protected procedure — enforces minimum organization role level.
 *
 * `requireRole("Admin")` — only Owner and Admin can access.
 * `requireRole("Viewer")` — any authenticated organization member can access.
 */
export function requireRole(minRole: Role) {
  const minIndex = ORGANIZATION_ROLES.indexOf(minRole);
  if (minIndex === -1) throw new Error(`Invalid role: ${minRole}`);

  return orgProcedure.use(({ ctx, next }) => {
    const userRole = ctx.membership.role as Role;
    const userIndex = ORGANIZATION_ROLES.indexOf(userRole);

    if (userIndex === -1 || userIndex > minIndex) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires ${minRole}+ role, current: ${userRole}`,
      });
    }

    return next({
      ctx: {
        session: { ...ctx.session, user: ctx.session.user },
        membership: ctx.membership,
        organizationId: ctx.organizationId,
        userRole,
      },
    });
  });
}

async function enforceRateLimit(input: {
  organizationId: string;
  subject: string;
  route: string;
}) {
  const policy = await db.query.SecurityPolicy.findFirst({
    where: eq(SecurityPolicy.organizationId, input.organizationId),
  });
  const limit = policy?.defaultRateLimitPerMinute ?? 120;
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const result = await db.execute(sql`
    insert into rate_limit_bucket (
      organization_id,
      subject,
      route,
      window_start,
      count,
      "limit",
      created_at,
      updated_at
    )
    values (
      ${input.organizationId},
      ${input.subject},
      ${input.route},
      ${windowStart},
      1,
      ${limit},
      now(),
      now()
    )
    on conflict (organization_id, subject, route, window_start)
    do update set
      count = rate_limit_bucket.count + 1,
      "limit" = ${limit},
      updated_at = now()
    returning count
  `);
  const count = rowsFromExecuteResult(result)[0]?.count ?? 1;

  if (count > limit) {
    rateLimitRejectionsTotal.inc({ route: input.route });
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded for ${input.route}.`,
    });
  }
}

function rowsFromExecuteResult(result: unknown): { count: number }[] {
  const rows = Array.isArray(result)
    ? result
    : Array.isArray((result as { rows?: unknown }).rows)
      ? (result as { rows: unknown[] }).rows
      : [];

  return rows
    .map((row) => {
      if (typeof row !== "object" || row === null) return null;
      const count = (row as { count?: unknown }).count;
      return {
        count: typeof count === "number" ? count : Number(count ?? 0),
      };
    })
    .filter((row): row is { count: number } => row !== null);
}
