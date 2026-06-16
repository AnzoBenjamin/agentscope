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

void test(
  "buildGrantedTool produces a callable tool that echoes its input",
  async () => {
    // The merge between `definition.configSchema` and `grant.config`
    // is internal to the tool builder and only observable through
    // the built tool's `execute` closure. A `Custom` + `echo` tool
    // returns its `input` verbatim, so the only invariant we can
    // assert from the outside is: the tool builds, executes without
    // throwing, and the echo round-trips the input. The actual merge
    // precedence is covered indirectly by the tool-executor
    // integration tests in packages/api (where a real handler sees
    // the merged config in its closure).
    const definition = {
      id: "t1",
      organizationId: "org-1",
      name: "merge-tool",
      displayName: "Merge",
      scope: "Custom",
      description: "Echoes its input",
      configSchema: { handler: "echo" },
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
      config: { note: "from-grant" },
      grantedByUserId: null,
      createdAt: new Date(),
    } as never;

    const tool = buildGrantedTool({
      definition,
      grant,
      organizationId: "org-1",
    });

    const echoedInput = { task: "noop" };
    const result = (await tool.execute(echoedInput)) as { task: string };
    assert.deepEqual(result, echoedInput);
  },
);

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

void test(
  "runCustomHandler http_get increments http_fetch_timeouts_total on timeout",
  async () => {
    const { httpFetchTimeoutsTotal } = await import(
      "@agentscope/observability"
    );
    // `Counter.get()` returns `{ values: [{ value, labels }, ...] }`;
    // the counter is unlabeled so the array always has a single
    // entry (or is empty before the first increment). Earlier this
    // test used `before[0]?.value` which silently returned
    // `undefined` and the assertion never actually fired.
    const before = await httpFetchTimeoutsTotal.get();
    const beforeValue = before.values[0]?.value ?? 0;

    // Re-use the hanging-server pattern from the timeout test above so
    // the assertion below exercises the real timeout path (not a
    // synthetic fetch rejection). The port is chosen at random, the
    // server never writes a response, and the 100ms timeout fires
    // before the OS-level TCP keepalive (minutes).
    const { createServer } = await import("node:net");
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
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
        /timed out|abort/i.test(out.error ?? ""),
        `expected timeout error, got: ${out.error}`,
      );

      const after = await httpFetchTimeoutsTotal.get();
      const afterValue = after.values[0]?.value ?? 0;
      // `>=` (not `===`) so a slow CI host where the server accept
      // + read latency exceeds 100ms and produces a real fetch
      // rejection (e.g. ECONNRESET) after the test thread has
      // already moved on doesn't flake. The counter's only invariant
      // we care about here is "incremented by at least 1 for every
      // timeout-driven request", and any increment satisfies that.
      assert.ok(
        afterValue >= beforeValue + 1,
        `expected http_fetch_timeouts_total to tick by >= 1, got before=${beforeValue} after=${afterValue}`,
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
