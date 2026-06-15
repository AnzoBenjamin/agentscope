/**
 * Splunk MCP Server integration.
 *
 * Connects to the official Splunk MCP Server via stdio transport
 * to execute searches, list indexes, and query agent event data
 * directly through the Model Context Protocol.
 *
 * MCP Server: https://github.com/splunk/mcp-server-splunk
 *
 * Configuration via environment variables:
 * - SPLUNK_MCP_ENABLED: Set to "true" to enable MCP integration
 * - SPLUNK_MCP_COMMAND: Path to the MCP server (default: "splunk-mcp-server")
 * - SPLUNK_URL: Splunk management URL (e.g. https://splunk:8089). AgentScope
 *   aliases this to the SPLUNK_HOST env var the MCP server expects.
 * - SPLUNK_TOKEN: Splunk auth token (optional). The upstream MCP server
 *   currently only supports basic auth, so this is unused there today.
 * - SPLUNK_USERNAME: Splunk username for basic auth (default: admin)
 * - SPLUNK_PASSWORD: Splunk password for basic auth
 * - SPLUNK_INDEX: Default index to search (default: "main")
 * - SPLUNK_VERIFY_SSL: "false" to accept self-signed TLS certs on the
 *   management API (default: "true"). Must be "false" for the default
 *   `splunk/splunk:latest` image in dev.
 */

import type { ChildProcess } from "node:child_process";

import { createLogger } from "@agentscope/observability";

const logger = createLogger("telemetry.mcp");

interface McpToolResult {
  content: { type: string; text?: string }[];
}

interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  error?: { message?: string; code?: number };
}

let mcpClient: McpClient | null = null;
let mcpEnabled = false;

/**
 * Status of the live MCP connection. The dashboard's "MCP-enabled" badge
 * reads this on every render (via `splunk.workerHealth`) so the badge
 * reflects a real, currently-open connection — not a stale config flag.
 */
export interface McpHeartbeatSample {
  /** ISO timestamp when the attempt finished (success or failure). */
  at: string;
  /** True when the MCP `tools/list` round-trip succeeded. */
  ok: boolean;
  /** Human-readable error message, only present when `ok === false`. */
  error: string | null;
  /** Duration of the attempt in milliseconds (success or failure). */
  durationMs: number;
}

export interface SplunkMcpStatus {
  /** Whether MCP is configured in this process at all (env-level). */
  configured: boolean;
  /** True only when the client is connected and a heartbeat has succeeded. */
  connected: boolean;
  /** Whether the client object exists (may be `false` after a failed init). */
  clientPresent: boolean;
  /** ISO timestamp of the last successful initialize/heartbeat call. */
  lastConnectedAt: string | null;
  /** ISO timestamp of the last heartbeat attempt. */
  lastHeartbeatAt: string | null;
  /** Last error message from init or heartbeat, if any. */
  lastError: string | null;
  /** Tool names reported by the MCP server at connect time. */
  tools: string[];
  /** Identity of the process that owns this connection (worker id, pid). */
  processId: string;
  /** Splunk management URL the client is talking to. */
  url: string;
  /**
   * Ring buffer of recent heartbeat attempts (success and failure). The
   * dashboard renders these as a small sparkline so operators can spot
   * a flapping MCP connection before the readiness badge flips red.
   */
  heartbeatHistory: McpHeartbeatSample[];
}

/**
 * Number of recent heartbeat attempts to retain. With a 30s heartbeat
 * cadence this is roughly the last 10 minutes — enough to spot a
 * flapping connection but small enough to keep the `/healthz` payload
 * tiny.
 */
const HEARTBEAT_HISTORY_MAX = 20;
const heartbeatHistory: McpHeartbeatSample[] = [];
function recordHeartbeat(sample: McpHeartbeatSample): void {
  heartbeatHistory.push(sample);
  if (heartbeatHistory.length > HEARTBEAT_HISTORY_MAX) {
    heartbeatHistory.splice(
      0,
      heartbeatHistory.length - HEARTBEAT_HISTORY_MAX,
    );
  }
}

const status: SplunkMcpStatus = {
  configured: false,
  connected: false,
  clientPresent: false,
  lastConnectedAt: null,
  lastHeartbeatAt: null,
  lastError: null,
  tools: [],
  processId: `pid:${process.pid}`,
  url: process.env.SPLUNK_URL ?? "",
  heartbeatHistory: [],
};

const SPLUNK_MCP_COMMAND =
  process.env.SPLUNK_MCP_COMMAND ?? "splunk-mcp-server";
const SPLUNK_MCP_ENABLED = process.env.SPLUNK_MCP_ENABLED === "true";
const SPLUNK_URL = process.env.SPLUNK_URL ?? "";
const SPLUNK_TOKEN = process.env.SPLUNK_TOKEN ?? "";
const SPLUNK_MCP_USERNAME = process.env.SPLUNK_USERNAME ?? "admin";
const SPLUNK_MCP_PASSWORD = process.env.SPLUNK_PASSWORD ?? "";
const SPLUNK_INDEX = process.env.SPLUNK_INDEX ?? "main";
const SPLUNK_VERIFY_SSL = process.env.SPLUNK_VERIFY_SSL ?? "true";

/** True when either token or basic auth credentials are available. */
const hasAuth =
  !!SPLUNK_TOKEN || !!(SPLUNK_MCP_USERNAME && SPLUNK_MCP_PASSWORD);

status.configured = SPLUNK_MCP_ENABLED && !!SPLUNK_URL && hasAuth;
status.url = SPLUNK_URL;

/** Minimal MCP stdio client using child_process */
class McpClient {
  private process: ChildProcess;
  private buffer = "";
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private constructor(proc: ChildProcess) {
    this.process = proc;

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processLines();
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      logger.debug({ stderr: data.toString().trim() }, "mcp server stderr");
    });

    this.process.on("exit", (code: number | null) => {
      if (code !== 0) {
        logger.warn({ code }, "mcp server exited");
        status.lastError = `mcp server exited with code ${code}`;
      } else {
        status.lastError = "mcp server exited cleanly";
      }
      status.connected = false;
      status.clientPresent = false;
      mcpClient = null;
      mcpEnabled = false;
    });
  }

  /** Create a connected McpClient. Returns null on failure. */
  static async create(): Promise<McpClient | null> {
    const { spawn } = await import("node:child_process");
    const proc = spawn(SPLUNK_MCP_COMMAND, [], {
      env: {
        ...process.env,
        // splunk-mcp-server expects SPLUNK_HOST (a full URL) rather than SPLUNK_URL.
        SPLUNK_HOST: SPLUNK_URL,
        // Accept self-signed certs on the Splunk management API in dev.
        // Defaults to "true" so production keeps strict verification; the
        // dev compose stack (splunk/splunk:latest) needs "false" via .env.
        SPLUNK_VERIFY_SSL,
        SPLUNK_USERNAME: SPLUNK_MCP_USERNAME,
        SPLUNK_PASSWORD: SPLUNK_MCP_PASSWORD,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    // `spawn` can fail synchronously (ENOENT when the binary is missing on
    // PATH) — surface that as a status error rather than crashing the worker.
    proc.on("error", (err) => {
      status.lastError = `failed to spawn ${SPLUNK_MCP_COMMAND}: ${err.message}`;
      logger.error(
        { err, command: SPLUNK_MCP_COMMAND },
        "failed to spawn splunk mcp server",
      );
    });
    return new McpClient(proc);
  }

  private processLines(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        // JSON-RPC response
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          if (msg.error) {
            p.reject(new Error(msg.error.message ?? "MCP error"));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  private async sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = ++this.nextId;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Timeout after 15 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request ${method} timed out`));
        }
      }, 15000);
    });

    this.process.stdin?.write(request + "\n");
    return promise;
  }

  async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agentscope", version: "1.0.0" },
    });
  }

  async listTools(): Promise<
    { name: string; description: string; inputSchema: unknown }[]
  > {
    const result = await this.sendRequest("tools/list", {});
    // Defensive: the MCP server should respond with `{ tools: [...] }`
    // but a malformed payload would throw a `TypeError` on `.tools`.
    // `mcpHeartbeat` runs every 30s on a long-lived worker, so a single
    // bad response shouldn't crash the process.
    if (
      !result ||
      typeof result !== "object" ||
      !("tools" in result) ||
      !Array.isArray((result as { tools: unknown }).tools)
    ) {
      throw new Error("MCP tools/list returned an unexpected payload shape");
    }
    return (result as {
      tools: { name: string; description: string; inputSchema: unknown }[];
    }).tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const result = (await this.sendRequest("tools/call", {
      name,
      arguments: args,
    })) as McpToolResult;
    return result;
  }

  disconnect(): void {
    this.process.kill();
  }
}

/**
 * Initialize the MCP connection to Splunk.
 * Called once at startup; subsequent calls re-verify the existing client
 * (cheap `tools/list` round-trip) and re-attach if the process exited.
 */
export async function initSplunkMcp(): Promise<void> {
  if (mcpClient) {
    status.clientPresent = true;
    mcpEnabled = true;
    return;
  }
  if (!SPLUNK_MCP_ENABLED) {
    status.lastError = "SPLUNK_MCP_ENABLED is not true";
    logger.debug("SPLUNK_MCP_ENABLED is not true - MCP disabled");
    return;
  }
  if (!SPLUNK_URL || !hasAuth) {
    status.lastError = "SPLUNK_URL or auth not set";
    logger.debug("SPLUNK_URL or auth not set - MCP disabled");
    return;
  }

  try {
    mcpClient = await McpClient.create();
    if (!mcpClient) {
      status.lastError = "McpClient.create() returned null";
      logger.error("failed to create mcp client");
      recordHeartbeat({
        at: new Date().toISOString(),
        ok: false,
        error: status.lastError,
        durationMs: 0,
      });
      return;
    }
    status.clientPresent = true;
    await mcpClient.initialize();
    mcpEnabled = true;

    const tools = await mcpClient.listTools();
    status.connected = true;
    status.lastConnectedAt = new Date().toISOString();
    status.lastError = null;
    status.tools = tools.map((t) => t.name);

    // The initial `tools/list` round-trip counts as a "first heartbeat"
    // for visualization — the dashboard's sparkline will be populated
    // from the very first sample, so operators see the full history
    // immediately after a worker restart.
    recordHeartbeat({
      at: status.lastConnectedAt,
      ok: true,
      error: null,
      durationMs: 0,
    });

    logger.info(
      { toolCount: tools.length, tools: status.tools },
      "connected to splunk mcp server",
    );
  } catch (error) {
    status.connected = false;
    status.lastError =
      error instanceof Error ? error.message : String(error);
    mcpClient = null;
    mcpEnabled = false;
    recordHeartbeat({
      at: new Date().toISOString(),
      ok: false,
      error: status.lastError,
      durationMs: 0,
    });
    logger.error({ err: error }, "mcp init failed");
  }
}

export function isMcpEnabled(): boolean {
  return mcpEnabled && mcpClient !== null;
}

/**
 * Tear down the MCP child process. Called on worker shutdown so the
 * splunk-mcp-server child doesn't become an orphan when the parent
 * exits. Safe to call when MCP was never initialized.
 */
export function disconnectSplunkMcp(): void {
  if (!mcpClient) return;
  try {
    mcpClient.disconnect();
  } catch (error) {
    logger.warn({ err: error }, "mcp disconnect threw");
  }
  mcpClient = null;
  mcpEnabled = false;
  status.connected = false;
  status.clientPresent = false;
  status.lastError = "mcp disconnected by client";
  // Clear the ring buffer so the dashboard resets after a worker
  // restart — the next worker will start with an empty history rather
  // than showing stale samples from the previous run.
  heartbeatHistory.length = 0;
}

/**
 * Snapshot of the current MCP connection state. The dashboard's
 * "MCP-enabled" badge renders `connected`; the rest is shown in the
 * Splunk readiness panel so operators can debug "why is the badge amber".
 */
export function getMcpStatus(): SplunkMcpStatus {
  // `connected` is a function of the live client + last heartbeat. Without
  // a heartbeat, the badge would stay green forever after a single
  // successful init even if the server died; `mcpHeartbeat()` refreshes
  // `lastHeartbeatAt` (and `lastError` on failure) on a cadence set by
  // the worker.
  return {
    ...status,
    clientPresent: mcpClient !== null,
    connected: mcpEnabled && mcpClient !== null && status.connected,
    // Defensive copy so the panel can't mutate the singleton's ring
    // buffer. Cost is trivial (≤ HEARTBEAT_HISTORY_MAX entries).
    heartbeatHistory: heartbeatHistory.slice(),
  };
}

/**
 * Refresh `lastHeartbeatAt` and verify the MCP connection is still alive.
 * Called by the worker on a short interval; safe to call from anywhere.
 * No-ops when MCP is not configured.
 *
 * Uses a metadata `tools/list` round-trip (not a real search) so the
 * heartbeat never spawns a Splunk search job — it produces no audit log
 * entries on the Splunk side and is cheap on the MCP server.
 */
export async function mcpHeartbeat(): Promise<void> {
  if (!SPLUNK_MCP_ENABLED || !SPLUNK_URL || !hasAuth) {
    return;
  }

  const startedAt = Date.now();
  const heartbeatAt = new Date().toISOString();
  status.lastHeartbeatAt = heartbeatAt;

  if (!mcpClient) {
    await initSplunkMcp();
  }
  if (!mcpClient) {
    // initSplunkMcp populated `status.lastError` already. We still need
    // a sparkline sample so the dashboard can see that a heartbeat was
    // *attempted* (and failed) — otherwise the buffer stays empty and
    // the "no samples yet" state hides ongoing trouble.
    recordHeartbeat({
      at: heartbeatAt,
      ok: false,
      error: status.lastError ?? "mcp client not initialized",
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  try {
    const tools = await mcpClient.listTools();
    status.connected = true;
    status.lastConnectedAt = new Date().toISOString();
    status.lastError = null;
    status.tools = tools.map((t) => t.name);
    recordHeartbeat({
      at: status.lastConnectedAt,
      ok: true,
      error: null,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    status.connected = false;
    status.lastError =
      error instanceof Error ? error.message : String(error);
    recordHeartbeat({
      at: heartbeatAt,
      ok: false,
      error: status.lastError,
      durationMs: Date.now() - startedAt,
    });
    logger.warn({ err: error }, "mcp heartbeat failed");
  }
}

/**
 * Search Splunk via MCP.
 * Uses the Splunk MCP server's search capability.
 */
export async function mcpSearch(
  query: string,
  earliest = "-7d",
  latest = "now",
): Promise<unknown> {
  if (!mcpClient || !mcpEnabled) {
    await initSplunkMcp();
  }

  if (!mcpClient || !mcpEnabled) {
    status.lastError = "mcp client not connected";
    throw new Error(
      "Splunk MCP is not connected. Configure SPLUNK_MCP_ENABLED=true, SPLUNK_URL, credentials, and SPLUNK_MCP_COMMAND.",
    );
  }

  try {
    const result = await mcpClient.callTool("splunk_search", {
      query: `search index=${SPLUNK_INDEX} sourcetype=agentscope:event ${query}`,
      earliest_time: earliest,
      latest_time: latest,
      output_mode: "json",
    });
    // Treat a successful search as proof the connection is alive.
    status.connected = true;
    status.lastConnectedAt = new Date().toISOString();
    status.lastError = null;
    return result;
  } catch (error) {
    status.connected = false;
    status.lastError =
      error instanceof Error ? error.message : String(error);
    logger.error({ err: error, query }, "mcp search failed");
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Query agent event counts by type via MCP.
 */
export async function mcpAgentEventCount(): Promise<unknown> {
  return mcpSearch("| stats count by eventType");
}

/**
 * Query cost breakdown by agent via MCP.
 */
export async function mcpCostByAgent(): Promise<unknown> {
  return mcpSearch(
    "eventType=CostRecorded | stats sum(cost) as total_cost by agentName",
  );
}

/**
 * Query anomaly events detected via MCP.
 */
export async function mcpAnomalyQuery(metric: string): Promise<unknown> {
  return mcpSearch(
    `eventType="${metric}" | stats count by sessionId | where count > 3`,
  );
}
