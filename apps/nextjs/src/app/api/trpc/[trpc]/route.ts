import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@agentscope/api";
import {
  createLogger,
  createRequestLogger,
  trpcRequestDurationSeconds,
} from "@agentscope/observability";

import { auth } from "~/auth/server";
import { initObservability } from "~/lib/init";
import { env } from "~/env";

const logger = createLogger("nextjs.trpc");

// `NEXT_PUBLIC_APP_URL` is typed as a non-optional URL string (see env.ts
// client schema with `z.url().default("http://localhost:3000")`). The
// comma-split below also accepts a list of origins so multi-domain
// deployments (preview + prod) can be allow-listed from a single env var.
const allowedOrigins = env.NEXT_PUBLIC_APP_URL.split(",")
  .map((s: string) => s.trim())
  .filter((s: string): s is string => Boolean(s));

function setCorsHeaders(req: NextRequest, res: Response): Response {
  const origin = req.headers.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Credentials", "true");
  } else if (env.NODE_ENV !== "production") {
    res.headers.set("Access-Control-Allow-Origin", "*");
  }
  res.headers.set("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-agentscope-organization-id",
  );
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export const OPTIONS = (req: NextRequest) => setCorsHeaders(req, new Response(null, { status: 204 }));

const handler = async (req: NextRequest) => {
  initObservability();
  const { logger: reqLogger } = createRequestLogger({
    component: "trpc",
    path: new URL(req.url).pathname,
  });

  const start = Date.now();
  let ok = true;
  try {
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      router: appRouter,
      req,
      createContext: () =>
        createTRPCContext({
          auth: auth,
          headers: req.headers,
        }),
      onError({ error, path }) {
        ok = false;
        reqLogger.error(
          { err: error, path },
          "tRPC request failed",
        );
      },
    });

    trpcRequestDurationSeconds.observe(
      { path: new URL(req.url).pathname, ok: String(ok) },
      (Date.now() - start) / 1000,
    );
    return setCorsHeaders(req, response);
  } catch (error) {
    trpcRequestDurationSeconds.observe(
      { path: new URL(req.url).pathname, ok: "false" },
      (Date.now() - start) / 1000,
    );
    logger.error({ err: error }, "tRPC handler crashed");
    return setCorsHeaders(
      req,
      new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
};

export { handler as GET, handler as POST };
