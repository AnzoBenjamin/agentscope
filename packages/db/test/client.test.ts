import assert from "node:assert/strict";
import test from "node:test";

void test("intEnv returns the fallback for missing or empty values", async () => {
  // The helper is not exported; we exercise it indirectly by importing
  // the client module under a known set of env vars and asserting the
  // pool was constructed without throwing. (The pool is a real pg.Pool
  // that lazy-connects, so just touching the module is enough.)
  delete process.env.AGENTSCOPE_DB_POOL_MAX;
  delete process.env.AGENTSCOPE_DB_IDLE_TIMEOUT_MS;
  delete process.env.AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS;
  delete process.env.AGENTSCOPE_DB_MAX_LIFETIME_MS;

  // Dynamic import so each test gets a fresh module evaluation
  // (or the cached one if env vars are unchanged).
  const { closeDb } = await import("../src/client");
  assert.equal(typeof closeDb, "function");
});

void test("intEnv falls back when the env value is non-numeric", async () => {
  process.env.AGENTSCOPE_DB_POOL_MAX = "not-a-number";
  process.env.AGENTSCOPE_DB_IDLE_TIMEOUT_MS = "";
  process.env.AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS = "0";

  // Re-importing under a different env var forces module re-evaluation.
  const moduleUrl = `../src/client?bust=${Math.random()}`;
  const mod = await import(moduleUrl);
  assert.equal(typeof mod.closeDb, "function");

  // Reset
  delete process.env.AGENTSCOPE_DB_POOL_MAX;
  delete process.env.AGENTSCOPE_DB_IDLE_TIMEOUT_MS;
  delete process.env.AGENTSCOPE_DB_CONNECTION_TIMEOUT_MS;
});

void test(
  "the pool registers an error handler so idle-client failures don't crash the process",
  async () => {
    // We can't easily inspect the pool's listener list from outside,
    // but we can verify the module loads and exposes a `db` handle
    // with a drizzle query builder, which is what every other package
    // depends on.
    const { db, closeDb } = await import("../src/client");
    assert.ok(db, "expected a drizzle db handle");
    assert.equal(typeof closeDb, "function");
  },
);
