import type { IncomingMessage, ServerResponse } from "node:http";

import { trpcRequestDurationSeconds } from "./metrics";

/**
 * Wrap an HTTP handler to record tRPC request duration metrics.
 * `path` is the logical procedure path (e.g. "agent.all"); `ok` is "true"
 * when the response status is < 500.
 */
export function withTrpcMetrics(
  path: string,
  handler: () => Promise<{ ok: boolean }>,
): Promise<{ ok: boolean }> {
  const end = trpcRequestDurationSeconds.startTimer({ path });
  return handler().then(
    (result) => {
      end({ ok: result.ok ? "true" : "false" });
      return result;
    },
    (error: unknown) => {
      end({ ok: "false" });
      throw error;
    },
  );
}

/**
 * Minimal Node http middleware: emits a `trpc_request_duration_seconds` row
 * for any request that comes through. Used by the Next.js metrics route.
 */
export function recordHttpRequestDuration(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  start: number,
) {
  const duration = (Date.now() - start) / 1000;
  const ok = res.statusCode < 500 ? "true" : "false";
  trpcRequestDurationSeconds.observe({ path, ok }, duration);
  void req;
}
