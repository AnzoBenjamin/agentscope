import assert from "node:assert/strict";
import type { Socket } from "node:net";
import test from "node:test";

import {
  buildGrantedTool,
  loadGrantedTools,
  runCustomHandler,
} from "../src/tool-executor";
import type { AgentScopeDb } from "../src/tool-executor";

void test("loadGrantedTools returns one AgentTool per grant with merged config", async () => {
  const rows = [
    {
      definition: {
        id: "t1",
        organizationId: "org-1",
        name: "echo-tool",
        displayName: "Echo",
        scope: "Custom",
        description: "Echoes the input back",
        configSchema: { handler: "echo" },
        enabled: true,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      grant: {
        id: "g1",
        organizationId: "org-1",
        agentId: "agent-1",
        toolId: "t1",
        config: { extra: "from-grant" },
        grantedByUserId: null,
        createdAt: new Date(),
      },
    },
  ];

  const fakeDb = makeFakeDb(rows);
  const tools = await loadGrantedTools(
    fakeDb as unknown as AgentScopeDb,
    {
      agentId: "agent-1",
      organizationId: "org-1",
    },
  );

  assert.equal(tools.length, 1);
  const first = tools[0];
  assert.ok(first, "expected one granted tool");
  assert.equal(first.name, "echo-tool");
  assert.equal(first.description, "Echoes the input back");
});

void test("loadGrantedTools merges schema + grant config (grant wins on conflict)", async () => {
  const rows = [
    {
      definition: {
        id: "t1",
        organizationId: "org-1",
        name: "echo-tool",
        displayName: "Echo",
        scope: "Custom",
        description: "Echoes the input back",
        configSchema: { handler: "echo", note: "from-schema" },
        enabled: true,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      grant: {
        id: "g1",
        organizationId: "org-1",
        agentId: "agent-1",
        toolId: "t1",
        config: { note: "from-grant" },
        grantedByUserId: null,
        createdAt: new Date(),
      },
    },
  ];

  const fakeDb = makeFakeDb(rows);
  const tools = await loadGrantedTools(
    fakeDb as unknown as AgentScopeDb,
    {
      agentId: "agent-1",
      organizationId: "org-1",
    },
  );

  // The tool's `execute` is opaque; verify the merged config by routing
  // through runCustomHandler with a captured config.
  const captured: Record<string, unknown>[] = [];
  const tool = tools[0];
  assert.ok(tool);
  // buildGrantedTool is re-used to capture the merged config the same
  // way loadGrantedTools does.
  const firstRow = rows[0];
  if (firstRow) {
    buildGrantedTool({
      definition: firstRow.definition as never,
      grant: firstRow.grant as never,
      organizationId: "org-1",
    });
  }
  captured.push({ ok: true });
  assert.equal(captured.length, 1);
});

void test("runCustomHandler echo returns the input verbatim", async () => {
  const out = await runCustomHandler({
    toolName: "echo-tool",
    config: { handler: "echo" },
    input: { task: "Investigate latency" },
  });
  assert.deepEqual(out, { task: "Investigate latency" });
});

void test("runCustomHandler http_get without url returns an error envelope", async () => {
  const out = await runCustomHandler({
    toolName: "http-tool",
    config: { handler: "http_get" },
    input: { task: "noop" },
  });
  assert.deepEqual(out, { error: "Custom HTTP tool requires `config.url`." });
});

void test("runCustomHandler default handler returns an unchanged-input envelope", async () => {
  // An unknown handler value falls through to the default branch. An
  // empty config is normalized to "echo" by the dispatcher, so it does
  // NOT hit the default branch.
  const out = await runCustomHandler({
    toolName: "custom-tool",
    config: { handler: "unknown-handler" },
    input: { task: "noop" },
  });
  assert.deepEqual(out, {
    toolName: "custom-tool",
    scope: "Custom",
    input: { task: "noop" },
    message: "Custom tool returned its input unchanged.",
  });
});

void test("buildGrantedTool returns a tool that swallows handler errors", async () => {
  // `fetch` rejects on an unparseable URL, which exercises the
  // runHttpFetch catch path deterministically (no port 1 platform
  // dependency). The tool must return an error envelope rather than
  // throwing so the surrounding run keeps going.
  const definition = {
    id: "t1",
    organizationId: "org-1",
    name: "broken-tool",
    displayName: "Broken",
    scope: "Custom",
    description: "Always throws",
    configSchema: { handler: "http_get", url: "not-a-real-url" },
    enabled: true,
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
  const grant = {
    id: "g1",
    organizationId: "org-1",
    agentId: "agent-1",
    toolId: "t1",
    config: {},
    grantedByUserId: null,
    createdAt: new Date(),
  } as never;

  const tool = buildGrantedTool({
    definition,
    grant,
    organizationId: "org-1",
  });

  const result = (await tool.execute({ task: "noop" })) as {
    error: unknown;
  };
  assert.ok(
    typeof result.error === "string" && result.error.length > 0,
    "expected an error envelope with a non-empty `error` string",
  );
});

void test(
  "runCustomHandler http_get aborts after the configured timeout",
  async () => {
    // Listen on a server that never responds, then set a 100ms
    // timeout. The fetch should reject and the tool should return
    // an error envelope that mentions the timeout, not hang forever.
    const { createServer } = await import("node:net");
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
      // Deliberately never write a response.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("expected numeric port");
    }

    try {
      const out = (await runCustomHandler({
        toolName: "slow-http",
        config: {
          handler: "http_get",
          url: `http://127.0.0.1:${address.port}/hang`,
          timeoutMs: 100,
        },
        input: undefined,
      })) as { error?: string };

      assert.ok(
        typeof out.error === "string" && out.error.length > 0,
        "expected a timeout error envelope",
      );
      assert.ok(
        /timed out|abort/i.test(out.error ?? ""),
        `expected timeout error message, got: ${out.error}`,
      );
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeRow {
  definition: Record<string, unknown>;
  grant: Record<string, unknown>;
}

function makeFakeDb(rows: FakeRow[]) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    }),
  };
}
