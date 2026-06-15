import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  WORKSPACE_SCOPE,
  normalizePackageName,
} from "./config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = resolve(__dirname, "templates");
const packageTemplate = readFileSync(
  resolve(templatesDir, "package.json.hbs"),
  "utf8",
);
const tsconfigTemplate = readFileSync(
  resolve(templatesDir, "tsconfig.json.hbs"),
  "utf8",
);
const eslintTemplate = readFileSync(
  resolve(templatesDir, "eslint.config.ts.hbs"),
  "utf8",
);

test("WORKSPACE_SCOPE is the canonical @agentscope scope", () => {
  assert.equal(WORKSPACE_SCOPE, "@agentscope");
});

test("normalizePackageName accepts a bare package name", () => {
  assert.equal(normalizePackageName("foo"), "foo");
  assert.equal(normalizePackageName("agents-ui"), "agents-ui");
  assert.equal(normalizePackageName("scope_with_underscores"), "scope_with_underscores");
});

test("normalizePackageName strips the @agentscope/ prefix", () => {
  assert.equal(normalizePackageName("@agentscope/foo"), "foo");
  assert.equal(normalizePackageName("@agentscope/nested-name"), "nested-name");
});

test("normalizePackageName trims surrounding whitespace", () => {
  assert.equal(normalizePackageName("  foo  "), "foo");
  assert.equal(normalizePackageName("\t@agentscope/bar\n"), "bar");
});

test("normalizePackageName rejects a different scope", () => {
  assert.throws(
    () => normalizePackageName("@acme/foo"),
    /Package scope must be @agentscope\//,
  );
  assert.throws(
    () => normalizePackageName("@example/foo"),
    /Package scope must be @agentscope\//,
  );
  assert.throws(
    () => normalizePackageName("@scope/foo"),
    /Package scope must be @agentscope\//,
  );
});

test("normalizePackageName rejects the wrong scope even with whitespace", () => {
  assert.throws(
    () => normalizePackageName("  @acme/foo  "),
    /Package scope must be @agentscope\//,
  );
});

test("normalizePackageName rejects empty or whitespace input", () => {
  assert.throws(() => normalizePackageName(""), /cannot be empty/);
  assert.throws(() => normalizePackageName("   "), /cannot be empty/);
  assert.throws(() => normalizePackageName("\n"), /cannot be empty/);
});

test("normalizePackageName rejects non-string input", () => {
  assert.throws(() => normalizePackageName(null), /must be a string/);
  assert.throws(() => normalizePackageName(undefined), /must be a string/);
  assert.throws(() => normalizePackageName(42), /must be a string/);
  assert.throws(() => normalizePackageName({}), /must be a string/);
  assert.throws(() => normalizePackageName([]), /must be a string/);
});

test("normalizePackageName rejects path traversal characters", () => {
  assert.throws(
    () => normalizePackageName("foo/bar"),
    /path traversal characters/,
  );
  assert.throws(
    () => normalizePackageName(".."),
    /path traversal characters/,
  );
  assert.throws(
    () => normalizePackageName("../foo"),
    /path traversal characters/,
  );
  assert.throws(
    () => normalizePackageName("@agentscope/../escape"),
    /path traversal characters/,
  );
});

test("normalizePackageName rejects a scope with no trailing slash", () => {
  assert.throws(
    () => normalizePackageName("@agentscope"),
    /missing the trailing slash/,
  );
});

test("package.json.hbs template hardcodes the @agentscope/ prefix", () => {
  assert.match(
    packageTemplate,
    /"name":\s*"@agentscope\/\{\{\s*name\s*\}\}"/,
    "package.json.hbs must use the @agentscope/ scope",
  );
});

test("no template references the old @acme scope in any case", () => {
  for (const [name, body] of [
    ["package.json.hbs", packageTemplate],
    ["tsconfig.json.hbs", tsconfigTemplate],
    ["eslint.config.ts.hbs", eslintTemplate],
  ] as const) {
    assert.doesNotMatch(
      body,
      /acme/i,
      `${name} must not mention "acme" in any case`,
    );
  }
});

test("generator default config uses AgentScope branding", async () => {
  // Re-import the default export to inspect the plop config that
  // `turbo gen` actually loads. Plop's NodePlopAPI is a thin object whose
  // `setGenerator(name, config)` records the config internally; we
  // emulate just enough of the surface to capture it.
  const captures: Array<{
    name: string;
    description: string;
    message: string;
  }> = [];

  const fakePlop = {
    setGenerator(name: string, config: { description: string; prompts: Array<{ message: string }> }) {
      captures.push({
        name,
        description: config.description,
        message: config.prompts[0]?.message ?? "",
      });
    },
  };

  // Dynamically import the default export so we exercise the actual file
  // the user would run via `pnpm turbo gen`.
  const mod = await import("./config.ts");
  const generator = mod.default;
  if (typeof generator !== "function") {
    throw new Error("turbo/generators/config.ts must export a default function");
  }
  generator(fakePlop as never);

  assert.equal(captures.length, 1, "exactly one generator should be registered");
  const gen = captures[0]!;
  assert.equal(gen.name, "init");
  assert.match(
    gen.description,
    /AgentScope/,
    "generator description must mention AgentScope",
  );
  assert.doesNotMatch(
    gen.description,
    /Acme/,
    "generator description must not mention the old 'Acme' branding",
  );
  assert.match(
    gen.message,
    /@agentscope\//,
    "name prompt should advertise the @agentscope/ scope",
  );
});
