import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createLogger,
  createRequestLogger,
  newRequestId,
} from "../src/logger";
import {
  agentRunsTotal,
  getMetrics,
  initMetrics,
  registerAllMetrics,
  resetMetrics,
  serializeMetrics,
} from "../src/metrics";

void test("createLogger returns a child logger with bound component", () => {
  const logger = createLogger("test");
  assert.ok(logger);
  assert.equal(typeof logger.info, "function");
});

void test("createRequestLogger returns a request id and a bound logger", () => {
  const ctx = createRequestLogger({ component: "test" });
  assert.ok(ctx.requestId);
  assert.equal(typeof ctx.requestId, "string");
  assert.ok(ctx.logger);
  assert.equal(typeof ctx.withError, "function");
});

void test("newRequestId returns a unique id", () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.notEqual(a, b);
});

void test("metrics registry serializes after registering", async () => {
  resetMetrics();
  initMetrics();
  registerAllMetrics();
  agentRunsTotal.inc({ status: "Completed" });
  const output = await serializeMetrics();
  assert.ok(output.includes("agent_runs_total"));
});

void test("getMetrics returns the same registry after multiple calls", () => {
  const a = getMetrics();
  const b = getMetrics();
  assert.equal(a, b);
});
