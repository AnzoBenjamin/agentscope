import assert from "node:assert/strict";
import test from "node:test";

import {
  updatePolicyInputSchema,
} from "../src/router/compliance";
import type { UpdatePolicyInput } from "../src/router/compliance";

const validInput: UpdatePolicyInput = {
  retentionDays: 365,
  requireSplunkEvidence: true,
  redactSensitivePayloads: true,
  allowAuditExports: true,
  immutableAudit: false,
  enforceRetention: true,
  exportRequiresApproval: false,
  piiRedactionMode: "Basic",
};

void test("updatePolicyInputSchema accepts a valid policy", () => {
  const parsed = updatePolicyInputSchema.parse(validInput);
  assert.deepEqual(parsed, validInput);
});

void test("updatePolicyInputSchema accepts each documented PII redaction mode", () => {
  for (const mode of ["Off", "Basic", "Strict"] as const) {
    const parsed = updatePolicyInputSchema.parse({
      ...validInput,
      piiRedactionMode: mode,
    });
    assert.equal(parsed.piiRedactionMode, mode);
  }
});

void test("updatePolicyInputSchema accepts the retention floor (30 days)", () => {
  const parsed = updatePolicyInputSchema.parse({
    ...validInput,
    retentionDays: 30,
  });
  assert.equal(parsed.retentionDays, 30);
});

void test("updatePolicyInputSchema accepts the retention ceiling (3650 days)", () => {
  const parsed = updatePolicyInputSchema.parse({
    ...validInput,
    retentionDays: 3650,
  });
  assert.equal(parsed.retentionDays, 3650);
});

void test("updatePolicyInputSchema rejects retentionDays below the floor", () => {
  assert.throws(() =>
    updatePolicyInputSchema.parse({ ...validInput, retentionDays: 7 }),
  );
});

void test("updatePolicyInputSchema rejects retentionDays above the ceiling", () => {
  assert.throws(() =>
    updatePolicyInputSchema.parse({ ...validInput, retentionDays: 5000 }),
  );
});

void test("updatePolicyInputSchema rejects non-integer retentionDays", () => {
  assert.throws(() =>
    updatePolicyInputSchema.parse({ ...validInput, retentionDays: 30.5 }),
  );
});

void test("updatePolicyInputSchema rejects an unknown piiRedactionMode", () => {
  // Cast to silence the input-side type error; zod is the boundary we're testing.
  assert.throws(() =>
    updatePolicyInputSchema.parse({
      ...validInput,
      piiRedactionMode: "Aggressive" as unknown as UpdatePolicyInput["piiRedactionMode"],
    }),
  );
});

void test("updatePolicyInputSchema rejects a missing field", () => {
  const { requireSplunkEvidence: _omit, ...incomplete } = validInput;
  void _omit;
  assert.throws(() => updatePolicyInputSchema.parse(incomplete));
});

void test("updatePolicyInputSchema rejects a non-boolean toggle", () => {
  assert.throws(() =>
    updatePolicyInputSchema.parse({
      ...validInput,
      immutableAudit: "true" as unknown as boolean,
    }),
  );
});
