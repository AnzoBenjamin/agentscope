import assert from "node:assert/strict";
import test from "node:test";

void test("mcpSearch fails closed when Splunk MCP is not connected", async () => {
  process.env.SPLUNK_MCP_ENABLED = "false";
  process.env.SPLUNK_URL = "";
  process.env.SPLUNK_TOKEN = "";
  process.env.SPLUNK_PASSWORD = "";

  const { mcpSearch } = await import("../src/mcp");

  await assert.rejects(
    () => mcpSearch("| head 1"),
    /Splunk MCP is not connected/,
  );
});
