import assert from "node:assert/strict";
import test from "node:test";

void test(
  "module loads under default env (smoke test for the intEnv fallback path)",
  async () => {
    // With all the `AGENTSCOPE_DB_*` env vars deleted, `intEnv` falls
    // back to the hard-coded defaults. The pool is constructed
    // successfully (no thrown `new Pool(...)`); a real connection is
    // not opened because `pg.Pool` lazy-connects on first query. If
    // the intEnv helper misbehaved (e.g. threw on a non-numeric value
    // before the fallback) the import would throw and `closeDb`
    // would be undefined.
    delete process.env.AGENTSCOPE_DB_POOL_MAX;
    delete process.env.AGENTSCOPE_DB_IDLE_TIMEOUT_MS;
    delete process.env.AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS;
    delete process.env.AGENTSCOPE_DB_MAX_LIFETIME_MS;

    const { db, closeDb, __getPoolForTesting } = await import(
      `../src/client?bust=${Math.random()}`
    );
    assert.ok(db, "expected a drizzle db handle");
    assert.equal(typeof closeDb, "function");
    // The default `max` is 20 (see `intEnv("AGENTSCOPE_DB_POOL_MAX", 20)`
    // in client.ts). If the intEnv path is wired correctly, the
    // constructed pool's `.options.max` will be 20.
    assert.equal(
      __getPoolForTesting().options.max,
      20,
      "expected default pool max to be 20",
    );
  },
);

void test(
  "module loads with non-numeric env values (intEnv falls back, does not throw)",
  async () => {
    // `Number("not-a-number")` is `NaN`, so `intEnv` must fall back to
    // the default. The module must still construct the pool without
    // throwing — this is the "graceful degradation" path that keeps
    // the worker alive when an operator types
    // `AGENTSCOPE_DB_POOL_MAX=auto` in their .env.
    process.env.AGENTSCOPE_DB_POOL_MAX = "not-a-number";
    process.env.AGENTSCOPE_DB_IDLE_TIMEOUT_MS = "";
    process.env.AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS = "0";

    const { closeDb } = await import(
      `../src/client?bust=${Math.random()}`
    );
    assert.equal(typeof closeDb, "function");

    delete process.env.AGENTSCOPE_DB_POOL_MAX;
    delete process.env.AGENTSCOPE_DB_IDLE_TIMEOUT_MS;
    delete process.env.AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS;
  },
);

void test(
  "module loads with explicit pool limits (env values reach the pool options)",
  async () => {
    // Round-trip test: set `AGENTSCOPE_DB_POOL_MAX=7`, import the
    // client, and assert the pool's `.options.max` is 7. This is the
    // strongest check we can do without a real Postgres — it proves
    // the env var made it all the way from `process.env` to the
    // constructed `pg.Pool` options object.
    process.env.AGENTSCOPE_DB_POOL_MAX = "7";
    process.env.AGENTSCOPE_DB_IDLE_TIMEOUT_MS = "12345";
    process.env.AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS = "6789";
    process.env.AGENTSCOPE_DB_MAX_LIFETIME_MS = "1800000";

    const { __getPoolForTesting } = await import(
      `../src/client?bust=${Math.random()}`
    );
    const pool = __getPoolForTesting();
    assert.equal(pool.options.max, 7, "pool max should respect env var");
    assert.equal(
      pool.options.idleTimeoutMillis,
      12345,
      "idle timeout should respect env var",
    );
    assert.equal(
      pool.options.connectionTimeoutMillis,
      6789,
      "connection timeout should respect env var",
    );
    assert.equal(
      pool.options.maxLifetimeSeconds,
      1800,
      "max lifetime should respect env var (ms -> s conversion)",
    );

    delete process.env.AGENTSCOPE_DB_POOL_MAX;
    delete process.env.AGENTSCOPE_DB_IDLE_TIMEOUT_MS;
    delete process.env.AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS;
    delete process.env.AGENTSCOPE_DB_MAX_LIFETIME_MS;
  },
);

void test(
  "the pool registers an `error` listener so idle-client failures don't crash the process",
  async () => {
    // Without an `error` listener on the pool, an idle-client failure
    // (server-initiated disconnect, network reset) would throw
    // unhandled and kill the process. The wiring in client.ts adds
    // the listener inside the `pool.on("error", ...)` call, which we
    // can verify by counting listeners on the `error` event. The
    // test imports with a clean env so the listener count is
    // deterministic.
    delete process.env.AGENTSCOPE_DB_POOL_MAX;
    const { __getPoolForTesting } = await import(
      `../src/client?bust=${Math.random()}`
    );
    const errorListenerCount = __getPoolForTesting().listenerCount(
      "error",
    );
    assert.ok(
      errorListenerCount >= 1,
      `expected at least 1 'error' listener on the pool, got ${errorListenerCount}`,
    );
  },
);

void test(
  "pool `error` listener ticks db_pool_errors_total (verifies the wiring in client.ts)",
  async () => {
    // The wiring in `client.ts` is `pool.on('error', (err) =>
    // dbPoolErrorsTotal.inc())`. The previous version of this test
    // only called `inc()` directly, which would pass even if the
    // `pool.on(...)` line were deleted. Emit a synthetic `error` on
    // the pool (no real Postgres needed) and assert the counter ticks
    // — that's the exact code path that needs verification.
    const { dbPoolErrorsTotal } = await import("@agentscope/observability");
    delete process.env.AGENTSCOPE_DB_POOL_MAX;
    const { __getPoolForTesting } = await import(
      `../src/client?bust=${Math.random()}`
    );
    const pool = __getPoolForTesting();

    const before = await dbPoolErrorsTotal.get();
    const beforeValue = before.values[0]?.value ?? 0;

    // `emit` is synchronous; the `error` listener is also sync, so by
    // the time `emit` returns the counter has already been ticked.
    pool.emit("error", new Error("synthetic pool error"));

    const after = await dbPoolErrorsTotal.get();
    const afterValue = after.values[0]?.value ?? 0;
    assert.equal(
      afterValue,
      beforeValue + 1,
      `expected db_pool_errors_total to tick by 1 after pool.emit('error'), got before=${beforeValue} after=${afterValue}`,
    );
  },
);
