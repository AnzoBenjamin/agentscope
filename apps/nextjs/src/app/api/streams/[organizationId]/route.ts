import { and, eq } from "@agentscope/db";
import { db } from "@agentscope/db/client";
import { OrganizationMember } from "@agentscope/db/schema";
import { createLogger } from "@agentscope/observability";
import {
  getRecentStreamEvents,
  getStreamEventsAfter,
  sseConnectionClosed,
  sseConnectionOpened,
} from "@agentscope/telemetry";

import { getSession } from "~/auth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const logger = createLogger("api.streams");
const POLL_INTERVAL_MS = 2_000;
const INITIAL_REPLAY_LIMIT = 50;
const POLL_BATCH_LIMIT = 50;

async function isOrgMember(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(OrganizationMember.userId, userId),
      eq(OrganizationMember.organizationId, organizationId),
    ),
  });
  return member !== undefined;
}

/**
 * Server-Sent Events stream of organization-scoped AgentScope events.
 * Replays recent events on connect, then polls for strictly-newer events
 * every 2s. Authorized callers must be an active member of the organization.
 *
 * State (`closed`, `interval`, `lastEventId`, `controller`) lives on the
 * `GET` scope so both the `start()` method and the `cancel()` hook can
 * call the same `cleanup()`. Without hoisting, `cancel()` would not be
 * able to clear the poll interval and the `sse_connections` gauge would
 * drift upward on every disconnect.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  const session = await getSession();
  // The lint rule flagged the inner `?.` on `user` because better-auth
  // types the session user as `User` (non-nullable). The outer `?.` on
  // `session` is still required since `getSession` returns
  // `Session | null`.
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await isOrgMember(session.user.id, organizationId))) {
    return new Response("Forbidden", { status: 403 });
  }

  sseConnectionOpened(organizationId);

  const encoder = new TextEncoder();
  const userId = session.user.id;

  // Per-request state, shared between start() and cancel() so the
  // cancel hook and the abort listener both clear the poll interval
  // and decrement the gauge exactly once. `lastEventCreatedAt` is
  // the SSE cursor (the `createdAt` timestamp of the most recently
  // delivered event). It is NOT the random UUID `id`, which would
  // deliver duplicates and drop events because UUIDv4 ordering is
  // unrelated to insert order.
  const state = {
    closed: false,
    interval: null as ReturnType<typeof setInterval> | null,
    lastEventCreatedAt: null as Date | null,
    controller: null as ReadableStreamDefaultController<Uint8Array> | null,
  };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    sseConnectionClosed(organizationId);
    try {
      state.controller?.close();
    } catch {
      // already closed
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      // `start` is intentionally non-async so the abort listener can
      // be registered before we do any work. Async initialization runs
      // inside an IIFE that is fully guarded by `state.closed` and the
      // outer try/catch.
      state.controller = controller;
      try {
        // Signal readiness immediately so the client can clear its
        // `connecting` state.
        controller.enqueue(
          encoder.encode(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`),
        );

        void (async () => {
          try {
            // Seed the timeline with the most recent events, oldest-first.
            const recent = await getRecentStreamEvents(organizationId, {
              limit: INITIAL_REPLAY_LIMIT,
            });
            for (const event of recent.slice().reverse()) {
              if (state.closed) return;
              state.lastEventCreatedAt = event.createdAt;
              controller.enqueue(
                encoder.encode(
                  `event: stream\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`,
                ),
              );
            }
          } catch (err) {
            logger.error(
              { err, organizationId, userId },
              "SSE initial replay failed",
            );
          }

          if (state.closed) return;

          // Poll for strictly-newer events. The query filters by
          // `createdAt > lastEventCreatedAt` server-side and orders ascending
          // so the stream is gap-free. The cursor is on `createdAt` (not
          // `id`) because `StreamEvent.id` is a random UUIDv4 and
          // lexicographic UUID order is unrelated to insert order.
          state.interval = setInterval(() => {
            void (async () => {
              if (state.closed) return;
              if (!state.lastEventCreatedAt) return; // wait for the initial replay to seed
              try {
                const events = await getStreamEventsAfter(
                  organizationId,
                  state.lastEventCreatedAt,
                  { limit: POLL_BATCH_LIMIT },
                );
                for (const event of events) {
                  state.lastEventCreatedAt = event.createdAt;
                  controller.enqueue(
                    encoder.encode(
                      `event: stream\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`,
                    ),
                  );
                }
              } catch (err) {
                logger.error(
                  { err, organizationId, userId },
                  "SSE poll failed",
                );
              }
            })();
          }, POLL_INTERVAL_MS);
        })();
      } catch (err) {
        logger.error({ err, organizationId, userId }, "SSE stream crashed");
        cleanup();
        throw err;
      }
    },
    cancel() {
      // Both the cancel hook and the abort listener route through the
      // same idempotent cleanup.
      cleanup();
    },
  });

  // Register the abort listener as a belt-and-suspenders fallback in
  // case the runtime closes the stream without calling `cancel()`.
  request.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
