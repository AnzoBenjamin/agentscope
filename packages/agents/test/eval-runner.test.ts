import assert from "node:assert/strict";
import test from "node:test";

import { scoreEvaluation } from "../src/eval-runner";

void test("scoreEvaluation returns Passed with score 1 when no signals are expected", () => {
  const out = scoreEvaluation({
    events: [{ eventType: "ToolCalled", payload: { toolName: "x" } }],
    expectedSignals: [],
    passThreshold: 0.8,
  });
  assert.equal(out.score, 1);
  assert.equal(out.decision, "Passed");
  assert.deepEqual(out.matchedSignals, []);
  assert.deepEqual(out.missingSignals, []);
});

void test("scoreEvaluation marks Failed with score 0 when no signals match", () => {
  const out = scoreEvaluation({
    events: [{ eventType: "ToolCalled", payload: { toolName: "splunk-context-search" } }],
    expectedSignals: ["send-page", "open-jira"],
    passThreshold: 0.5,
  });
  assert.equal(out.score, 0);
  assert.equal(out.decision, "Failed");
  assert.deepEqual(out.matchedSignals, []);
  assert.deepEqual(out.missingSignals, ["send-page", "open-jira"]);
});

void test("scoreEvaluation marks Passed with score 1 when every signal matches", () => {
  const out = scoreEvaluation({
    events: [
      { eventType: "ToolCalled", payload: { toolName: "send-page" } },
      { eventType: "ToolCalled", payload: { toolName: "open-jira" } },
    ],
    expectedSignals: ["send-page", "open-jira"],
    passThreshold: 0.8,
  });
  assert.equal(out.score, 1);
  assert.equal(out.decision, "Passed");
  assert.deepEqual(out.matchedSignals, ["send-page", "open-jira"]);
  assert.deepEqual(out.missingSignals, []);
});

void test("scoreEvaluation marks Failed with partial score when only some signals match", () => {
  const out = scoreEvaluation({
    events: [{ eventType: "ToolCalled", payload: { toolName: "send-page" } }],
    expectedSignals: ["send-page", "open-jira"],
    passThreshold: 0.5,
  });
  assert.equal(out.score, 0.5);
  assert.equal(out.decision, "Passed");
  assert.deepEqual(out.matchedSignals, ["send-page"]);
  assert.deepEqual(out.missingSignals, ["open-jira"]);
});

void test("scoreEvaluation matches signals that are valid regexes", () => {
  const out = scoreEvaluation({
    events: [
      { eventType: "SplunkMcpSearch", payload: { query: "search index=main" } },
    ],
    expectedSignals: ["^Splunk.*"],
    passThreshold: 0.5,
  });
  assert.equal(out.score, 1);
  assert.equal(out.decision, "Passed");
});

void test("scoreEvaluation matches signals case-insensitively as substrings", () => {
  const out = scoreEvaluation({
    events: [
      {
        eventType: "ToolCalled",
        payload: { toolName: "Send-Page-V2" },
      },
    ],
    expectedSignals: ["send-page"],
    passThreshold: 0.5,
  });
  assert.equal(out.score, 1);
  assert.equal(out.decision, "Passed");
});

void test("scoreEvaluation matches signals against exact eventType", () => {
  const out = scoreEvaluation({
    events: [{ eventType: "CostRecorded", payload: { cost: 1.23 } }],
    expectedSignals: ["CostRecorded"],
    passThreshold: 0.5,
  });
  assert.equal(out.score, 1);
  assert.equal(out.decision, "Passed");
});

void test("scoreEvaluation treats an invalid regex as a substring match", () => {
  // An unclosed character class is not a valid regex; the matcher
  // should treat it as a plain string and still find it in the payload.
  const out = scoreEvaluation({
    events: [
      { eventType: "ToolCalled", payload: { toolName: "[unclosed" } },
    ],
    expectedSignals: ["[unclosed"],
    passThreshold: 0.5,
  });
  assert.equal(out.score, 1);
  assert.equal(out.decision, "Passed");
});

void test("scoreEvaluation passes at the exact threshold boundary", () => {
  const out = scoreEvaluation({
    events: [{ eventType: "ToolCalled", payload: { toolName: "alpha" } }],
    expectedSignals: ["alpha", "beta"],
    passThreshold: 0.5,
  });
  // 1 / 2 = 0.5; threshold is 0.5; >= passes.
  assert.equal(out.score, 0.5);
  assert.equal(out.decision, "Passed");
});

void test("scoreEvaluation fails just below the threshold boundary", () => {
  const out = scoreEvaluation({
    events: [{ eventType: "ToolCalled", payload: { toolName: "alpha" } }],
    expectedSignals: ["alpha", "beta", "gamma"],
    passThreshold: 0.5,
  });
  // 1 / 3 ≈ 0.333 < 0.5.
  assert.equal(out.score, 1 / 3);
  assert.equal(out.decision, "Failed");
});
