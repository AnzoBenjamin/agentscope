import assert from "node:assert/strict";
import test from "node:test";

void test(
  "mcpSearch fails closed when Splunk MCP is not connected",
  async () => {
    // The module captures `SPLUNK_MCP_ENABLED` and `SPLUNK_URL` into
    // module-local constants at import time. A previous test in this
    // file sets `SPLUNK_MCP_ENABLED=true`, so we must explicitly
    // clear every config knob before the import to force the
    // "not configured" branch. The `bust=` query string is a
    // best-effort cache-buster; the env-var clear is the real
    // mechanism that makes this test deterministic.
    delete process.env.SPLUNK_MCP_ENABLED;
    delete process.env.SPLUNK_URL;
    delete process.env.SPLUNK_TOKEN;
    delete process.env.SPLUNK_PASSWORD;

    const { __resetMcpForTesting, mcpSearch: freshSearch } = await import(
      `../src/mcp?bust=${Math.random()}`
    );
    __resetMcpForTesting();

    await assert.rejects(
      () => freshSearch("| head 1"),
      /Splunk MCP is not connected/,
    );
  },
);

void test(
  "initSplunkMcp suppresses reconnect attempts during the backoff window",
  async () => {
    // Force a configuration that will fail to spawn a child process
    // (binary does not exist on PATH). Two consecutive calls must not
    // re-spawn; the second should bail on the backoff gate so the
    // worker does not flood its own log on every 30s heartbeat.
    process.env.SPLUNK_MCP_ENABLED = "true";
    process.env.SPLUNK_MCP_COMMAND = "definitely-not-on-path-xyz";
    process.env.SPLUNK_URL = "https://localhost:8089";
    process.env.SPLUNK_TOKEN = "test-token";
    process.env.SPLUNK_PASSWORD = "";

    // Re-import so the module's `SPLUNK_MCP_ENABLED`/`SPLUNK_URL`/
    // `SPLUNK_MCP_COMMAND` constants reflect the test env. The
    // constants are captured at module load and would otherwise keep
    // the "not configured" value from a previous test.
    const bust = Math.random();
    const { initSplunkMcp, getMcpStatus, __resetMcpForTesting } =
      await import(`../src/mcp?bust=${bust}`);
    __resetMcpForTesting();

    await initSplunkMcp();
    const firstError = getMcpStatus().lastError;
    assert.ok(
      firstError && firstError.length > 0,
      `expected a non-empty error after first failed init, got: ${firstError}`,
    );

    await initSplunkMcp();
    const secondError = getMcpStatus().lastError;
    assert.ok(
      secondError && secondError.includes("backoff"),
      `expected backoff suppression, got: ${secondError}`,
    );
  },
);

void test(
  "initSplunkMcp increments mcp_init_failures_total{status=\"error\"} and {status=\"suppressed\"} on consecutive failures",
  async () => {
    // Same setup as the backoff-suppression test above: a binary that
    // does not exist on PATH so `spawn` fails. Two consecutive calls
    // exercise the error-then-suppressed counter pair.
    process.env.SPLUNK_MCP_ENABLED = "true";
    process.env.SPLUNK_MCP_COMMAND = "definitely-not-on-path-xyz";
    process.env.SPLUNK_URL = "https://localhost:8089";
    process.env.SPLUNK_TOKEN = "test-token";
    process.env.SPLUNK_PASSWORD = "";

    const bust = Math.random();
    const { initSplunkMcp, __resetMcpForTesting } = await import(
      `../src/mcp?bust=${bust}`
    );
    const { mcpInitFailuresTotal } = await import(
      "@agentscope/observability"
    );
    __resetMcpForTesting();

    const before = await mcpInitFailuresTotal.get();
    const errorBefore =
      before.values.find((m) => m.labels.status === "error")?.value ?? 0;
    const suppressedBefore =
      before.values.find((m) => m.labels.status === "suppressed")?.value ??
      0;

    // First call: the spawn fails, recordInitFailure() fires, and the
    // counter ticks under {status="error"}.
    await initSplunkMcp();
    // Second call: the backoff window is now active, so the spawn
    // never even tries — the counter ticks under {status="suppressed"}.
    await initSplunkMcp();

    const after = await mcpInitFailuresTotal.get();
    const errorAfter =
      after.values.find((m) => m.labels.status === "error")?.value ?? 0;
    const suppressedAfter =
      after.values.find((m) => m.labels.status === "suppressed")?.value ??
      0;

    assert.ok(
      errorAfter >= errorBefore + 1,
      `expected mcp_init_failures_total{status="error"} to tick by >=1, got before=${errorBefore} after=${errorAfter}`,
    );
    assert.ok(
      suppressedAfter >= suppressedBefore + 1,
      `expected mcp_init_failures_total{status="suppressed"} to tick by >=1, got before=${suppressedBefore} after=${suppressedAfter}`,
    );
  },
);

void test("mcpHeartbeat records a sample and updates lastHeartbeatAt", async () => {
  const bust = Math.random();
  const { mcpHeartbeat, getMcpStatus, __resetMcpForTesting } = await import(
    `../src/mcp?bust=${bust}`
  );
  __resetMcpForTesting();

  await mcpHeartbeat();
  const status = getMcpStatus();
  assert.ok(
    status.heartbeatHistory.length >= 1,
    "expected at least one heartbeat sample",
  );
  const last = status.heartbeatHistory[status.heartbeatHistory.length - 1];
  assert.ok(last, "expected a heartbeat sample");
  assert.equal(last?.ok, false, "disconnected MCP should fail heartbeat");
  assert.ok(
    status.lastHeartbeatAt !== null,
    "expected lastHeartbeatAt to be set",
  );
});
