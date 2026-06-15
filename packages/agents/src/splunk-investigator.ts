import { generateText } from "ai";
import { createLogger, splunkMcpSearchDurationSeconds } from "@agentscope/observability";

import { mcpSearch, trackEvent } from "@agentscope/telemetry";

const logger = createLogger("agents.investigator");

export interface SplunkInvestigationResult {
  status: "completed";
  usedSplunkMcp: boolean;
  query: string;
  summary: string;
  findings: string[];
  riskLevel: "low" | "medium" | "high";
  rawResults: unknown;
}

/**
 * Optional provider config for the investigation summary call. When the
 * investigated agent has a custom baseURL / API key, the same configuration
 * is reused so the summarization LLM matches the agent's own provider.
 */
export interface SplunkInvestigationProviderConfig {
  modelProvider: string;
  modelName: string;
  baseUrl?: string | null;
  apiKey?: string | null;
}

export async function investigateSessionWithSplunk(input: {
  sessionId: string;
  task: string;
  agentName: string;
  output?: string | null;
  providerConfig?: SplunkInvestigationProviderConfig;
}): Promise<SplunkInvestigationResult> {
  // Splunk HEC acks events immediately, but the indexer has a small delay
  // (typically 1–3s, longer under load) before events become searchable.
  // The investigator often runs within a second of SessionCompleted, so a
  // single search would race the indexer and report a false negative.
  // `searchWithRetry` polls Splunk with exponential backoff until the
  // session-scoped query returns events or the retry budget is exhausted.
  const escapedSessionId = input.sessionId.replace(/"/g, '\\"');
  const query = `index=main sourcetype=agentscope:event _raw="*${escapedSessionId}*" | spath input=_raw | sort _time | head 100 | table _time eventType agentName provider model modelName toolName cost tokensIn tokensOut duration error`;

  let rawResults: unknown;
  const mcpStart = Date.now();
  let attempts = 0;
  try {
    rawResults = await searchWithRetry(query, input.sessionId, (count) => {
      attempts = count;
    });
    splunkMcpSearchDurationSeconds.observe(
      { status: "ok", attempts: String(attempts) },
      (Date.now() - mcpStart) / 1000,
    );
    await trackEvent({
      sessionId: input.sessionId,
      eventType: "SplunkMcpSearch",
      payload: {
        query,
        connected: true,
        attempts,
      },
    });
  } catch (error) {
    splunkMcpSearchDurationSeconds.observe(
      { status: "error", attempts: String(attempts) },
      (Date.now() - mcpStart) / 1000,
    );
    logger.error(
      { err: error, sessionId: input.sessionId },
      "splunk mcp search failed",
    );
    await trackEvent({
      sessionId: input.sessionId,
      eventType: "SplunkInvestigationFailed",
      payload: {
        query,
        reason:
          error instanceof Error ? error.message : "Splunk MCP search failed",
        attempts,
      },
    });

    throw error;
  }

  // Determine whether the session-scoped search actually returned any
  // events. The Splunk MCP server's response shape is
  // `{ success, query, eventCount, executionTime, events: [...] }`; if
  // `eventCount === 0` the session is genuinely absent from Splunk and
  // any LLM-generated summary would be confabulation from cross-session
  // noise. In that case we surface a deterministic, explicit
  // "no events found" message instead of asking the LLM to summarize
  // nothing.
  const { eventCount, hasSessionEvents } = extractMcpResult(rawResults);

  let summary: string;
  if (!hasSessionEvents) {
    summary = buildNoEventsSummary(input, eventCount);
  } else {
    try {
      summary = await summarizeWithAi(input, rawResults, input.providerConfig);
    } catch (error) {
      await trackEvent({
        sessionId: input.sessionId,
        eventType: "SplunkInvestigationFailed",
        payload: {
          query,
          reason:
            error instanceof Error
              ? error.message
              : "Investigation summary failed",
        },
      });
      throw error;
    }
  }
  const findings = buildFindings(rawResults, input.output, hasSessionEvents);
  const riskLevel = inferRiskLevel(rawResults, input.output, hasSessionEvents);

  const result = {
    status: "completed" as const,
    usedSplunkMcp: true,
    query,
    summary,
    findings,
    riskLevel,
    rawResults,
  };

  await trackEvent({
    sessionId: input.sessionId,
    eventType: "SplunkInvestigationCompleted",
    payload: {
      status: result.status,
      summary: result.summary,
      riskLevel: result.riskLevel,
      usedSplunkMcp: result.usedSplunkMcp,
      sessionEventCount: eventCount,
    },
  });

  return result;
}

async function summarizeWithAi(
  input: {
    sessionId: string;
    task: string;
    agentName: string;
    output?: string | null;
  },
  rawResults: unknown,
  providerConfig?: SplunkInvestigationProviderConfig,
): Promise<string> {
  const model = await resolveInvestigatorModel(providerConfig);

  const result = await generateText({
    model,
    system:
      "You are a Splunk AI operations analyst. Summarize agent telemetry evidence for an incident commander. Be concise and cite the signals you used.",
    prompt: `Task: ${input.task}
Agent: ${input.agentName}
Session: ${input.sessionId}
Agent output: ${input.output ?? "No output captured"}

Splunk MCP result:
${safeJson(rawResults, 6000)}

Write a 3 sentence operational investigation summary.`,
  });

  return result.text;
}

async function resolveInvestigatorModel(
  providerConfig?: SplunkInvestigationProviderConfig,
) {
  const provider = (providerConfig?.modelProvider ?? "OpenAI").toLowerCase();
  const { baseUrl, apiKey } = providerConfig ?? {};

  // Custom OpenAI-compatible endpoint (TokenRouter, OpenRouter, etc.)
  if (baseUrl) {
    const { createOpenAI } = await import("@ai-sdk/openai");
    // Omit `apiKey` entirely when none is set so self-hosted gateways
    // (Ollama, vLLM) don't see `Authorization: Bearer undefined`.
    const openai = apiKey
      ? createOpenAI({ baseURL: baseUrl, apiKey })
      : createOpenAI({ baseURL: baseUrl });
    return openai(providerConfig?.modelName ?? "gpt-4o-mini");
  }

  if (provider.includes("anthropic")) {
    const { anthropic } = await import("@ai-sdk/anthropic");
    return anthropic(providerConfig?.modelName ?? "claude-3-5-haiku-latest");
  }

  if (provider.includes("gemini")) {
    // No first-party @ai-sdk/google wrapper in this repo. Fall back to the
    // OpenAI-compatible Gemini endpoint if the user has an API key, otherwise
    // raise a clear error so the operator knows to wire one up.
    if (!process.env.GEMINI_API_KEY && !apiKey) {
      throw new Error(
        "Gemini investigations require GEMINI_API_KEY or a custom baseUrl/apiKey on the agent.",
      );
    }
    const { createOpenAI } = await import("@ai-sdk/openai");
    const openai = createOpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: apiKey ?? process.env.GEMINI_API_KEY ?? "",
    });
    return openai(providerConfig?.modelName ?? "gemini-2.5-flash");
  }

  // Default: OpenAI
  if (!process.env.OPENAI_API_KEY && !apiKey) {
    throw new Error(
      "OpenAI investigations require OPENAI_API_KEY or a custom baseUrl/apiKey on the agent.",
    );
  }
  if (apiKey) {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const openai = createOpenAI({ apiKey });
    return openai(providerConfig?.modelName ?? "gpt-4o-mini");
  }
  const { openai } = await import("@ai-sdk/openai");
  return openai(providerConfig?.modelName ?? "gpt-4o-mini");
}

function buildFindings(
  rawResults: unknown,
  output?: string | null,
  hasSessionEvents = true,
): string[] {
  const findings: string[] = [
    "Splunk MCP was queried for the session telemetry timeline.",
  ];

  if (!hasSessionEvents) {
    // When the session is absent from Splunk we deliberately do NOT
    // report the cross-session head sample as a finding — that would
    // mislead the operator. Instead we surface the pipeline gap.
    findings.push(
      "The session was not found in Splunk — events may still be flushing to the HEC outbox or the search window does not include this session.",
    );
    if (!output) {
      findings.push("The session output is empty or unavailable.");
    }
    return findings;
  }

  const serialized = safeJson(rawResults, 4000).toLowerCase();
  findings.push(
    "AgentScope recorded replayable events for model, tool, cost, and completion signals.",
  );

  if (serialized.includes("sessionfailed") || serialized.includes("error")) {
    findings.push("Failure indicators were present in the Splunk result.");
  } else {
    findings.push(
      "No explicit failure event was present in the Splunk result.",
    );
  }

  if (serialized.includes("costrecorded") || serialized.includes("cost")) {
    findings.push("Cost telemetry was included for attribution.");
  }

  if (!output) {
    findings.push("The session output is empty or unavailable.");
  }

  return findings;
}

function inferRiskLevel(
  rawResults: unknown,
  output?: string | null,
  hasSessionEvents = true,
): "low" | "medium" | "high" {
  if (!hasSessionEvents) {
    // An unindexed session is always at least a medium-severity finding
    // for an incident commander — the absence of telemetry makes root
    // cause analysis impossible until the forwarding pipeline is fixed.
    return "medium";
  }

  const serialized = safeJson(rawResults, 4000).toLowerCase();

  if (serialized.includes("sessionfailed") || serialized.includes("error")) {
    return "high";
  }

  if (!output) {
    return "medium";
  }

  return "low";
}

/**
 * Issue a session-scoped SPL search and, if the result is empty, retry
 * with exponential backoff to absorb Splunk's HEC → indexer delay. The
 * returned value is always the last attempt's raw response so the caller
 * can read its `eventCount` for the "no events" summary when the retry
 * budget is exhausted.
 */
async function searchWithRetry(
  query: string,
  sessionId: string,
  onAttempt: (attempts: number) => void,
): Promise<unknown> {
  const maxAttempts = 3;
  const baseDelayMs = 1500;
  const maxDelayMs = 5000;

  let lastResults: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 2), maxDelayMs);
      logger.warn(
        { sessionId, attempt, delayMs: delay, query },
        "splunk session not yet indexed, retrying after backoff",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    onAttempt(attempt);
    const result = await mcpSearch(query);
    lastResults = result;
    const { hasSessionEvents } = extractMcpResult(result);
    if (hasSessionEvents) {
      if (attempt > 1) {
        logger.info(
          { sessionId, attempt },
          "splunk session found after retry",
        );
      }
      return result;
    }
  }
  return lastResults;
}

/**
 * Pull the `eventCount` out of the Splunk MCP response, tolerating both
 * the `{ content: [{ text: "..." }] }` envelope (the standard MCP
 * `text` content type) and a direct JSON object. Returns
 * `hasSessionEvents=false` when the count is zero, undefined, or the
 * payload is unparseable so the caller can avoid LLM confabulation.
 */
function extractMcpResult(rawResults: unknown): {
  eventCount: number;
  hasSessionEvents: boolean;
} {
  const unwrapped = unwrapMcpResult(rawResults);
  if (unwrapped === null || typeof unwrapped !== "object") {
    return { eventCount: 0, hasSessionEvents: false };
  }
  const count = (unwrapped as { eventCount?: unknown }).eventCount;
  if (typeof count === "number" && count > 0) {
    return { eventCount: count, hasSessionEvents: true };
  }
  return { eventCount: typeof count === "number" ? count : 0, hasSessionEvents: false };
}

function unwrapMcpResult(rawResults: unknown): unknown {
  if (rawResults === null || rawResults === undefined) return null;
  if (typeof rawResults === "string") {
    try {
      return JSON.parse(rawResults);
    } catch {
      return rawResults;
    }
  }
  // MCP `text` content envelope: { content: [{ type: "text", text: "<json>" }] }
  const content = (rawResults as { content?: unknown }).content;
  if (
    Array.isArray(content) &&
    content.length > 0 &&
    typeof content[0] === "object" &&
    content[0] !== null &&
    (content[0] as { type?: unknown }).type === "text" &&
    typeof (content[0] as { text?: unknown }).text === "string"
  ) {
    try {
      return JSON.parse((content[0] as { text: string }).text);
    } catch {
      return (content[0] as { text: string }).text;
    }
  }
  return rawResults;
}

function buildNoEventsSummary(
  input: {
    sessionId: string;
    task: string;
    agentName: string;
    output?: string | null;
  },
  eventCount: number,
): string {
  const trimmedTask =
    input.task.length > 140 ? input.task.slice(0, 137) + "..." : input.task;
  const outputNote = input.output
    ? ` The session returned an output of ${input.output.length} characters.`
    : " The session produced no captured output.";
  return [
    `Session \`${input.sessionId}\` is not yet visible in Splunk — the session-scoped search returned ${eventCount} indexed events.`,
    `This usually means the HEC outbox is still flushing, the session just completed (Splunk indexes with a small delay), or the Splunk MCP server is not pointed at the same index as the AgentScope worker.`,
    `Task: "${trimmedTask}".${outputNote} Retry the investigation in 1–2 minutes; if the gap persists, check the worker's telemetry outbox pending count on the Splunk readiness panel.`,
  ].join(" ");
}

function safeJson(value: unknown, limit: number): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}
