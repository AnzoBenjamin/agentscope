import assert from "node:assert/strict";
import test from "node:test";

import { runFailureTransition } from "../src/run-queue-policy";

void test("runFailureTransition retries transient failures before max attempts", () => {
  const now = new Date("2026-06-13T00:00:00.000Z");
  const transition = runFailureTransition({
    attempts: 1,
    maxAttempts: 3,
    permanent: false,
    now,
  });

  assert.equal(transition.shouldRetry, true);
  assert.equal(transition.status, "Retrying");
  assert.equal(transition.retryDelayMs, 5000);
  assert.equal(transition.runAfter.toISOString(), "2026-06-13T00:00:05.000Z");
  assert.equal(transition.completedAt, null);
});

void test("runFailureTransition dead-letters when max attempts are exhausted", () => {
  const now = new Date("2026-06-13T00:00:00.000Z");
  const transition = runFailureTransition({
    attempts: 3,
    maxAttempts: 3,
    permanent: false,
    now,
  });

  assert.equal(transition.shouldRetry, false);
  assert.equal(transition.status, "DeadLettered");
  assert.equal(transition.runAfter, now);
  assert.equal(transition.completedAt, now);
});

void test("runFailureTransition dead-letters permanent errors without retry", () => {
  const now = new Date("2026-06-13T00:00:00.000Z");
  const transition = runFailureTransition({
    attempts: 1,
    maxAttempts: 3,
    permanent: true,
    now,
  });

  assert.equal(transition.shouldRetry, false);
  assert.equal(transition.status, "DeadLettered");
});
