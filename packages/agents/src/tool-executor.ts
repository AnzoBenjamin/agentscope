import { and, eq } from "@agentscope/db";
import type { db as defaultDb } from "@agentscope/db/client";
import {
  AgentToolDefinition,
  AgentToolGrant,
} from "@agentscope/db/schema";
import { createLogger } from "@agentscope/observability";
import { mcpSearch } from "@agentscope/telemetry";

import type { AgentTool } from "./types";

/**
 * Accepts the shared drizzle pg client (or a transaction handle) so the
 * run queue can pass a transactional handle if it ever needs to load
 * granted tools inside a larger atomic block.
 */
export type AgentScopeDb = typeof defaultDb;

export interface LoadGrantedToolsInput {
  agentId: string;
  organizationId: string;
}

const logger = createLogger("agents.tool-executor");

/**
 * Load every enabled `AgentToolDefinition` granted to this agent and
 * return an executable `AgentTool` for each. The Agent runtime is
 * expected to invoke each returned tool through `Agent.useTool`, which
 * records the `ToolCalled` / `ToolReturned` telemetry events so the
 * eval runner can match `expectedSignals` against the recorded event
 * stream.
 *
 * Tools that fail to execute (network errors, bad config, etc.) are
 * caught inside the returned tool and surface as `{ toolName, error }`
 * envelopes so a tool failure never breaks the agent run.
 */
export async function loadGrantedTools(
  db: AgentScopeDb,
  input: LoadGrantedToolsInput,
): Promise<AgentTool[]> {
  const rows = await db
    .select({
      definition: AgentToolDefinition,
      grant: AgentToolGrant,
    })
    .from(AgentToolGrant)
    .innerJoin(
      AgentToolDefinition,
      eq(AgentToolGrant.toolId, AgentToolDefinition.id),
    )
    .where(
      and(
        eq(AgentToolGrant.agentId, input.agentId),
        eq(AgentToolGrant.organizationId, input.organizationId),
        eq(AgentToolDefinition.enabled, true),
      ),
    );

  return rows.map((row) =>
    buildGrantedTool({
      definition: row.definition,
      grant: row.grant,
      organizationId: input.organizationId,
    }),
  );
}

export interface BuildGrantedToolInput {
  definition: typeof AgentToolDefinition.$inferSelect;
  grant: typeof AgentToolGrant.$inferSelect;
  organizationId: string;
}

/**
 * Build a single executable `AgentTool` from a grant + definition pair.
 * Exported so the test harness can construct tools without a real db.
 */
export function buildGrantedTool(
  input: BuildGrantedToolInput,
): AgentTool {
  const { definition, grant, organizationId } = input;
  const config = mergeConfig(definition.configSchema, grant.config);

  return {
    name: definition.name,
    description: definition.description ?? "",
    execute: async (toolInput: unknown) => {
      let output: unknown;
      try {
        switch (definition.scope) {
          case "ReadTelemetry":
            output = await runReadTelemetry(organizationId);
            break;
          case "SearchSplunk":
            output = await runSearchSplunk(organizationId, config);
            break;
          case "SendNotification":
            output = runSendNotification({
              toolName: definition.name,
              organizationId,
              input: toolInput,
            });
            break;
          case "WriteTicket":
            output = runWriteTicket({
              toolName: definition.name,
              organizationId,
              input: toolInput,
            });
            break;
          case "Custom":
            output = await runCustomHandler({
              toolName: definition.name,
              config,
              input: toolInput,
            });
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { tool: definition.name, err: message },
          "granted tool failed; returning error envelope",
        );
        output = { toolName: definition.name, error: message };
      }
      return output;
    },
  };
}

function mergeConfig(
  schema: unknown,
  grantConfig: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(schema) ? { ...schema } : {};
  if (isPlainObject(grantConfig)) Object.assign(base, grantConfig);
  return base;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

// ---------------------------------------------------------------------------
// Built-in scope implementations
// ---------------------------------------------------------------------------

async function runReadTelemetry(organizationId: string) {
  const query = `search index=main sourcetype=agentscope:event organizationId="${organizationId}" | sort -_time | head 50 | table _time eventType agentName provider model toolName cost duration error`;
  const results = await mcpSearch(query);
  return {
    query,
    results,
    count: Array.isArray(results) ? results.length : 0,
  };
}

async function runSearchSplunk(
  organizationId: string,
  config: Record<string, unknown>,
) {
  const provided =
    typeof config.query === "string" && config.query.trim().length > 0
      ? config.query
      : null;
  const query =
    provided ??
    `search index=main sourcetype=agentscope:event organizationId="${organizationId}" | head 50`;
  const results = await mcpSearch(query);
  return {
    query,
    results,
    count: Array.isArray(results) ? results.length : 0,
  };
}

function runSendNotification(input: {
  toolName: string;
  organizationId: string;
  input: unknown;
}) {
  return {
    delivered: true,
    toolName: input.toolName,
    organizationId: input.organizationId,
    payload: input.input,
    timestamp: new Date().toISOString(),
  };
}

function runWriteTicket(input: {
  toolName: string;
  organizationId: string;
  input: unknown;
}) {
  return {
    ticketed: true,
    toolName: input.toolName,
    organizationId: input.organizationId,
    payload: input.input,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Custom handler implementations
// ---------------------------------------------------------------------------

export interface CustomHandlerInput {
  toolName: string;
  config: Record<string, unknown>;
  input: unknown;
}

/**
 * Dispatch a Custom-scope tool's `execute` based on its `handler` config.
 * The dispatcher is exported so the test harness can verify the
 * `echo` / `http_get` / `http_post` / `splunk_mcp` branches without
 * needing a live database.
 */
export async function runCustomHandler(
  input: CustomHandlerInput,
): Promise<unknown> {
  const handler =
    typeof input.config.handler === "string" ? input.config.handler : "echo";
  switch (handler) {
    case "echo":
      return input.input;
    case "http_get":
      return runHttpFetch(input.config, undefined);
    case "http_post":
      return runHttpFetch(input.config, input.input);
    case "splunk_mcp":
      return runSplunkMcpHandler(input.config, input.input);
    default:
      return {
        toolName: input.toolName,
        scope: "Custom",
        input: input.input,
        message: "Custom tool returned its input unchanged.",
      };
  }
}

async function runHttpFetch(
  config: Record<string, unknown>,
  body: unknown,
): Promise<unknown> {
  const url = typeof config.url === "string" ? config.url : "";
  if (!url) return { error: "Custom HTTP tool requires `config.url`." };
  const headers = isPlainObject(config.headers) ? config.headers : {};
  // Default 30s is the same ceiling used by `packages/telemetry/splunk.ts`
  // for outbound HEC calls — keeps the blast radius of a slow upstream
  // bounded across the platform. Operators can override per-tool via
  // `config.timeoutMs` (integer milliseconds, 1s..10m). Without an
  // explicit abort signal, `fetch()` in Node has no timeout and will
  // happily hang for the OS-default TCP keepalive (often 2h+), which
  // would pin a worker slot forever.
  const requestedTimeout =
    typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs)
      ? Math.min(Math.max(config.timeoutMs, 1_000), 10 * 60_000)
      : 30_000;
  // Use `AbortSignal.timeout` (Node 17.3+) so the signal is a real
  // DOM-spec `AbortSignal` — `fetch()` honors it for both DNS and the
  // response stream, and rejects with a `TimeoutError` we can catch.
  const signal = AbortSignal.timeout(requestedTimeout);
  try {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: headers as Record<string, string>,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      body: text.slice(0, 16 * 1024),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // `AbortSignal.timeout()` rejects with a `TimeoutError` whose name is
    // `"TimeoutError"`. Surface a stable string the eval runner can
    // assert on, and include the URL so debug logs identify the offender.
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || /aborted|timeout/i.test(message));
    return {
      error: isTimeout
        ? `HTTP tool timed out after ${requestedTimeout}ms: ${url}`
        : `HTTP tool failed: ${message}`,
    };
  }
}

async function runSplunkMcpHandler(
  config: Record<string, unknown>,
  input: unknown,
): Promise<unknown> {
  const template =
    typeof config.query === "string" && config.query.length > 0
      ? config.query
      : "search index=main | head 20";
  const inputKey = typeof config.inputKey === "string" ? config.inputKey : null;
  const query =
    inputKey && isPlainObject(input) && typeof input[inputKey] === "string"
      ? template.replaceAll(`{{${inputKey}}}`, String(input[inputKey]))
      : template;
  const results = await mcpSearch(query);
  return {
    query,
    results,
    count: Array.isArray(results) ? results.length : 0,
  };
}
