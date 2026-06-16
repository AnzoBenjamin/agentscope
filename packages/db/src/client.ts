import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * Read an integer env var with a fallback. Stays stringly-typed until the
 * final `Number()` so a malformed value (e.g. `AGENTSCOPE_DB_POOL_MAX=auto`)
 * surfaces as `NaN` and falls back to the default instead of throwing
 * during module init — a thrown `new Pool(...)` would crash the entire
 * process on boot.
 */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Connection pool sized for the production workload.
 *
 * Without explicit limits, `pg.Pool` defaults to 10 connections, but the
 * scheduler + run-claim + outbox workers all share this pool, so a burst
 * of long-running queries (LLM calls holding a connection for seconds)
 * can starve every other caller. The defaults below are tuned for a
 * single worker process on Postgres with `max_connections=100`:
 *
 *   max:               20  — leaves headroom for the worker, Next.js
 *                              tRPC, and migration tooling
 *   idleTimeoutMillis: 30s — recycle idle connections so we don't
 *                              burn through a shared pool when traffic
 *                              is bursty
 *   connectionTimeoutMillis: 10s — fail fast on a wedged DB instead of
 *                              letting requests pile up behind a hung
 *                              connect
 *   max_lifetime:      30m — bound how long a single TCP connection can
 *                              live so DNS / TLS rotations roll through
 *
 * Every value is env-overridable for operators who run with a different
 * pool topology. See `.env.example` for the full list.
 */
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  max: intEnv("AGENTSCOPE_DB_POOL_MAX", 20),
  idleTimeoutMillis: intEnv("AGENTSCOPE_DB_IDLE_TIMEOUT_MS", 30_000),
  connectionTimeoutMillis: intEnv(
    "AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS",
    10_000,
  ),
  // `pg`'s `maxLifetimeSeconds` is set via the `max_lifetime` option in
  // recent versions; older versions ignore it, so we keep the spread
  // narrow to avoid breaking the build.
  ...(intEnv("AGENTSCOPE_DB_MAX_LIFETIME_MS", 30 * 60_000) > 0
    ? {
        maxLifetimeSeconds: Math.floor(
          intEnv("AGENTSCOPE_DB_MAX_LIFETIME_MS", 30 * 60_000) / 1000,
        ),
      }
    : {}),
});

// Surface unexpected pool errors (idle-client timeouts, server-initiated
// disconnects) rather than crashing the process. The Node `pg` driver
// emits `error` on the pool itself when no query is currently attached
// to the failing client; without a listener Node's default handler
// throws and the process dies.
pool.on("error", (err) => {
  // Use stderr via console here: importing a logger would pull in the
  // observability package at module load and risk a circular import
  // with the tRPC server. This handler should be rare (network blips,
  // DBA-restarted Postgres), so console is the right level of
  // observability.
  console.error(
    "[db.pool] idle client errored and was removed from the pool",
    err,
  );
});

export const db = drizzle({
  client: pool,
  schema,
  casing: "snake_case",
});

/**
 * Exposed for tests and graceful-shutdown paths. Closes the pool so the
 * process can exit cleanly (the worker's shutdown handler awaits this
 * before `process.exit`). Calling this in the middle of a request will
 * fail pending queries — only call it on shutdown.
 */
export async function closeDb(): Promise<void> {
  await pool.end();
}
