/**
 * Sentry initialization helpers.
 *
 * Sentry is intentionally optional in AgentScope: local development should
 * not require an external service. The init functions check SENTRY_DSN and
 * short-circuit gracefully when it is unset.
 *
 * Callers that want Sentry enabled must:
 *   1. Add `@sentry/node` (server) and/or `@sentry/browser` (client) as
 *      dependencies in the app that calls `initServerSentry()` / `initBrowserSentry()`.
 *   2. Set `SENTRY_DSN` in the environment.
 *   3. (Optional) Set `SENTRY_RELEASE` to associate events with a git SHA.
 *
 * This module intentionally does NOT take a hard dependency on
 * `@sentry/node` / `@sentry/browser`. The dynamic `require` paths below
 * are wrapped in try/catch so a missing optional package is non-fatal.
 */

export interface SentryConfig {
  dsn: string;
  environment: string;
  release?: string;
  tracesSampleRate?: number;
}

let serverSentryInitialized = false;
let browserSentryInitialized = false;

export function readSentryConfig(): SentryConfig | null {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  const env = process.env.NODE_ENV ?? "development";
  const sampleRateEnv = process.env.SENTRY_TRACES_SAMPLE_RATE;
  const tracesSampleRate = sampleRateEnv ? Number(sampleRateEnv) : undefined;
  return {
    dsn,
    environment: env,
    ...(process.env.SENTRY_RELEASE
      ? { release: process.env.SENTRY_RELEASE }
      : {}),
    ...(typeof tracesSampleRate === "number" && !Number.isNaN(tracesSampleRate)
      ? { tracesSampleRate }
      : {}),
  };
}

export function isSentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

/**
 * Initialize Sentry for server-side code (workers, Next.js server actions).
 * Idempotent. No-op if SENTRY_DSN is unset.
 * Returns true if Sentry was initialized, false otherwise.
 */
export function initServerSentry(): boolean {
  if (serverSentryInitialized) return true;
  const config = readSentryConfig();
  if (!config) return false;
  try {
    // Dynamic require keeps @sentry/node as an optional peer dep.
    // The cast is safe because Sentry.init returns void.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/node") as {
      init: (cfg: SentryConfig) => void;
    };
    Sentry.init(config);
    serverSentryInitialized = true;
    return true;
  } catch {
    // @sentry/node not installed or init failed — treat as disabled.
    return false;
  }
}

/**
 * Initialize Sentry for browser-side code.
 * Idempotent. No-op if SENTRY_DSN is unset or `window` is undefined.
 * Returns true if Sentry was initialized, false otherwise.
 */
export function initBrowserSentry(): boolean {
  if (browserSentryInitialized) return true;
  // `window` is not in the default Node lib types; check via globalThis.
  const w = (globalThis as { window?: unknown }).window;
  if (typeof w === "undefined") return false;
  const config = readSentryConfig();
  if (!config) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/browser") as {
      init: (cfg: SentryConfig) => void;
    };
    Sentry.init(config);
    browserSentryInitialized = true;
    return true;
  } catch {
    // @sentry/browser not installed or init failed — treat as disabled.
    return false;
  }
}

/**
 * Capture an exception in Sentry if enabled. Best-effort.
 * Safe to call even when Sentry is disabled.
 */
export function captureException(err: unknown): void {
  if (!isSentryEnabled()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require("@sentry/node") as {
      captureException: (e: unknown) => void;
    };
    Sentry.captureException(err);
  } catch {
    // ignore
  }
}
