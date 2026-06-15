import { randomUUID } from "node:crypto";

import pino from "pino";
import type { Logger } from "pino";

export type { Logger } from "pino";


const isProduction = process.env.NODE_ENV === "production";
const logLevel =
  process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug");

/**
 * Root logger. All other loggers in the AgentScope codebase
 * should be derived from this base.
 */
export const rootLogger: Logger = pino({
  level: logLevel,
  base: {
    service: process.env.AGENTSCOPE_SERVICE_NAME ?? "agentscope",
    env: process.env.NODE_ENV ?? "development",
    workerId: process.env.AGENTSCOPE_WORKER_ID,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.secret",
      "*.privateKey",
      "*.clientSecret",
      "*.refreshToken",
      "*.accessToken",
      "*.sessionToken",
      "*.apiKey",
      "*.api_key",
      "*.authorization",
      "*.cookie",
      "*.set-cookie",
      "*.headers.authorization",
      "*.headers.cookie",
      "*.headers['set-cookie']",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});

/**
 * Create a child logger for a specific subsystem.
 */
export function createLogger(component: string): Logger {
  return rootLogger.child({ component });
}

export interface RequestContext {
  requestId: string;
  userId?: string;
  organizationId?: string;
  path?: string;
}

/**
 * Create a request-scoped logger with bound context fields.
 * Returns a child logger plus the request id and a `withError` helper.
 */
export function createRequestLogger(context: {
  requestId?: string;
  userId?: string;
  organizationId?: string;
  path?: string;
  component?: string;
} = {}): {
  requestId: string;
  logger: Logger;
  withError: (err: unknown) => Record<string, unknown>;
} {
  const requestId = context.requestId ?? randomUUID();
  const logger = rootLogger.child({
    requestId,
    userId: context.userId,
    organizationId: context.organizationId,
    path: context.path,
    component: context.component,
  });

  return {
    requestId,
    logger,
    withError: (err: unknown) => ({
      err:
        err instanceof Error
          ? { message: err.message, stack: err.stack, name: err.name }
          : { message: String(err) },
    }),
  };
}

/**
 * Generate a request id without allocating a full request logger.
 */
export function newRequestId(): string {
  return randomUUID();
}
