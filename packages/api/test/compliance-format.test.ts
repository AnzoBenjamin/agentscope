import assert from "node:assert/strict";
import test from "node:test";

import {
  csvValue,
  redactValue,
  toCsv,
} from "../src/router/compliance";

/**
 * Typed wrapper around `redactValue`. The implementation returns
 * `unknown` because it can't prove the runtime structure is preserved
 * through recursion, but every test in this file IS asserting exactly
 * that — so the cast is honest. Runtime tests are the proof; the type
 * assertion just lets TypeScript stop complaining about property
 * access on `unknown`.
 */
function redact<T>(value: T): T {
  return redactValue(value) as T;
}

void test("csvValue escapes formula injection in user-controlled fields", () => {
  // The six characters Excel/LibreOffice/Sheets treat as a formula
  // start: `=`, `+`, `-`, `@`, TAB, CR. All must be prefixed with a
  // single quote (the standard "force-text" marker).
  for (const dangerous of [
    "=SUM(A1:A10)",
    "+CMD|'/c calc'!A0",
    "-2+3",
    "@SUM(1+1)*cmd|'/c calc'!A0",
    "\tTAB-prefixed",
    "\rCR-prefixed",
  ]) {
    const quoted = csvValue(dangerous);
    assert.ok(
      quoted.startsWith(`"'`) || quoted.startsWith(`"'\t`),
      `expected ${JSON.stringify(dangerous)} to be prefixed with a single quote, got ${quoted}`,
    );
    assert.ok(quoted.endsWith('"'));
  }
});

void test("csvValue does not prefix safe values", () => {
  // "Safe" means: no leading formula char, so the formula-injection
  // guard must NOT prepend `'`. Numbers/booleans are tested separately
  // because `csvValue` returns them unwrapped (no `"` boundary).
  for (const safe of [
    "normal",
    "value with = sign",
    "value with - dash",
    "user@example",
    "  spaces",
  ]) {
    const quoted = csvValue(safe);
    // Strip the surrounding quotes; the inner content must NOT start
    // with the formula-injection prefix `'`.
    assert.equal(quoted.startsWith('"'), true);
    assert.equal(quoted.endsWith('"'), true);
    const inner = quoted.slice(1, -1);
    assert.ok(
      !inner.startsWith("'"),
      `expected ${JSON.stringify(safe)} not to be formula-prefixed, got ${quoted}`,
    );
  }
});

void test("csvValue doubles internal quotes for valid CSV output", () => {
  // CSV escape rule: an internal `"` becomes `""`. Combined with
  // the formula-injection prefix, a value like `=say "hi"` should
  // become `"'=say ""hi"""` — the `=` triggers the prefix, the
  // internal `"` is doubled, and the whole field is wrapped.
  const quoted = csvValue(`=say "hi"`);
  assert.equal(quoted, `"'=say ""hi"""`);
});

void test("csvValue handles numbers, booleans, bigints, and null", () => {
  assert.equal(csvValue(42), "42");
  assert.equal(csvValue(true), "true");
  assert.equal(csvValue(false), "false");
  assert.equal(csvValue(0), "0");
  assert.equal(csvValue(null), "");
  assert.equal(csvValue(undefined), "");
});

void test("toCsv produces a header row + escaped data rows", () => {
  const csv = toCsv([
    { name: "=evil()", tokens: 100 },
    { name: "ok", tokens: 200 },
  ]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "name,tokens");
  // Formula injection in `name` is escaped
  assert.ok(lines[1]?.startsWith("\"'=evil()\","));
  // `tokens` is a number, no escape needed
  assert.ok(lines[1]?.endsWith("100"));
  assert.equal(lines[2], "\"ok\",200");
});

void test("toCsv returns an empty string for an empty row set", () => {
  assert.equal(toCsv([]), "");
});

void test("toCsv flattens nested objects via JSON.stringify", () => {
  const csv = toCsv([{ meta: { a: 1 }, value: "x" }]);
  assert.equal(csv, "meta,value\n\"{\"\"a\"\":1}\",\"x\"");
});

void test("redactValue preserves token counts (regression: not clobbered)", () => {
  const input = {
    tokens: 1000,
    tokensIn: 800,
    tokensOut: 200,
    totalTokens: 1000,
    promptTokens: 500,
    completionTokens: 300,
  };
  const redacted = redact(input);
  // The previous `isSensitiveKey` regex matched `token` as a prefix
  // and clobbered all of these with `"[redacted]"`, breaking
  // per-session cost attribution in the compliance Costs export.
  assert.equal(redacted.tokens, 1000);
  assert.equal(redacted.tokensIn, 800);
  assert.equal(redacted.tokensOut, 200);
  assert.equal(redacted.totalTokens, 1000);
  assert.equal(redacted.promptTokens, 500);
  assert.equal(redacted.completionTokens, 300);
});

void test("redactValue redacts secret-shaped keys", () => {
  const input = {
    apiKey: "sk-1234567890",
    apiKeyEncrypted: "ciphertext-blob",
    secret: "supersecret",
    password: "hunter2",
    accessToken: "token123",
    refreshToken: "token456",
    idToken: "oidc-token",
    bearerToken: "bearer",
    credential: "creds",
    authorization: "authz",
    name: "agent-1", // not sensitive
  };
  const redacted = redact(input);
  assert.equal(redacted.apiKey, "[redacted]");
  assert.equal(redacted.apiKeyEncrypted, "[redacted]");
  assert.equal(redacted.secret, "[redacted]");
  assert.equal(redacted.password, "[redacted]");
  assert.equal(redacted.accessToken, "[redacted]");
  assert.equal(redacted.refreshToken, "[redacted]");
  assert.equal(redacted.idToken, "[redacted]");
  assert.equal(redacted.bearerToken, "[redacted]");
  assert.equal(redacted.credential, "[redacted]");
  assert.equal(redacted.authorization, "[redacted]");
  // Non-secret fields are preserved
  assert.equal(redacted.name, "agent-1");
});

void test("redactValue redacts email addresses in strings", () => {
  const input = {
    author: "Anzo Benjamin <anzobnjmn@example.com>",
    description: "Contact me at jane.doe@agentscope.io for details.",
  };
  const redacted = redact(input);
  assert.ok(!redacted.author.includes("anzobnjmn@example.com"));
  assert.ok(redacted.author.includes("[redacted-email]"));
  assert.ok(!redacted.description.includes("jane.doe@agentscope.io"));
});

void test("redactValue recurses into nested objects and arrays", () => {
  const input = {
    runs: [
      { agentId: "a-1", apiKey: "sk-123", tokens: 100 },
      { agentId: "a-2", apiKey: "sk-456", tokens: 200 },
    ],
    meta: {
      owner: { apiKey: "sk-789", name: "root" },
    },
  };
  const redacted = redact(input);
  // `noUncheckedIndexedAccess` makes `runs[0]` `T | undefined` at the
  // type level. The runtime is fine (the test data has two entries),
  // and the asserts below prove it — so the `!` is honest. A `?.`
  // here would silently turn the asserts into no-ops, which is worse.
  const run0 = redacted.runs[0]!;
  const run1 = redacted.runs[1]!;
  const owner = redacted.meta.owner;
  assert.equal(run0.apiKey, "[redacted]");
  assert.equal(run0.tokens, 100);
  assert.equal(run1.apiKey, "[redacted]");
  assert.equal(run1.tokens, 200);
  assert.equal(owner.apiKey, "[redacted]");
  assert.equal(owner.name, "root");
});
