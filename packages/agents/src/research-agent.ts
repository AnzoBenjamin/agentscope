import { db } from "@agentscope/db/client";
import { createLogger } from "@agentscope/observability";
import { mcpSearch } from "@agentscope/telemetry";

import type { AgentConfig, AgentTool } from "./types";
import { Agent } from "./agent";
import { loadGrantedTools } from "./tool-executor";

const logger = createLogger("agents.research-agent");

/**
 * Research Agent: the primary operational investigator for AgentScope.
 *
 * Multi-step operational investigation workflow:
 * 1. Search recent AgentScope events through Splunk MCP
 * 2. Run any granted custom tools (ReadTelemetry, SearchSplunk,
 *    SendNotification, WriteTicket, Custom) for additional context
 * 3. Analyze findings using real AI model via Vercel AI SDK
 * 4. Generate structured report using real AI model
 *
 * Every step is auto-instrumented: tool calls become events, model calls are traced.
 */
export class ResearchAgent extends Agent {
  private readonly searchTool: AgentTool;

  constructor(id: string, overrides: Partial<AgentConfig> = {}) {
    super(id, {
      name: "Research Agent",
      description:
        "Investigates AI agent operations, gathers Splunk context, and produces structured incident reports.",
      modelProvider: "OpenAI",
      modelName: "gpt-4o",
      ...overrides,
      systemPrompt:
        overrides.systemPrompt ??
        "You are an expert AI operations analyst. Use Splunk event evidence to explain agent behavior, reliability risks, and cost impact.",
    });

    this.searchTool = {
      name: "splunk-context-search",
      description: "Search Splunk for recent AgentScope operational events",
      execute: async () => {
        return mcpSearch(
          `| sort -_time | head 20 | table _time sessionId eventType agentName provider model modelName toolName cost tokensIn tokensOut duration error`,
        );
      },
    };
  }

  protected async run(input: string, _sessionId: string): Promise<string> {
    const steps: string[] = [];
    const organizationId = this.config.organizationId;

    const searchResults = await this.useTool(this.searchTool, input);
    steps.push("## Splunk Context Results");
    steps.push(JSON.stringify(searchResults, null, 2));
    steps.push("");

    // Run any tools the user has granted to this agent. Their outputs
    // become part of the report and are forwarded to the AI prompts.
    const customToolResults = await this.runGrantedTools(
      input,
      organizationId,
    );
    if (customToolResults.size > 0) {
      steps.push("## Custom Tool Results");
      for (const [toolName, result] of customToolResults) {
        steps.push(`### ${toolName}`);
        const json = safeStringify(result);
        steps.push(json.length > 4096 ? `${json.slice(0, 4096)}\n...` : json);
        steps.push("");
      }
    }

    // Truncate the search results and custom tool outputs to a shared
    // per-prompt char budget before they're interpolated into the three
    // AI prompts below. A noisy `| head 20` result plus
    // `safeStringify(Object.fromEntries(customToolResults))` (capped at
    // 4096) can easily push the prompt past the model's context window
    // and 400; the structured report then becomes a generic "the model
    // failed" stub. `PROMPT_BUDGET_CHARS` is a conservative total —
    // the per-source slice is the budget divided by the number of
    // sources, so the three prompts stay roughly the same size.
    const PROMPT_BUDGET_CHARS = 12_000;
    const searchSummary = truncateForPrompt(
      safeStringify(searchResults),
      PROMPT_BUDGET_CHARS / 2,
    );
    // `customToolResultsJson` is reused across all three prompts below;
    // `JSON.stringify` on the full tool-output map is the expensive part,
    // so hoist it out and only `truncateForPrompt` the resulting string
    // for each prompt slice. `toolResultSummary` is the single shared
    // truncated view used by all three prompts (the plan, analysis, and
    // final report).
    const customToolResultsJson = safeStringify(
      Object.fromEntries(customToolResults),
    );
    const toolResultSummary = truncateForPrompt(
      customToolResultsJson,
      PROMPT_BUDGET_CHARS / 4,
    );

    const plan = await this.generate(
      `Create a brief operational investigation plan for this task using the Splunk context below.

Task: ${input}

Splunk context:
${searchSummary}

Custom tool outputs:
${toolResultSummary}`,
    );
    steps.push("## Investigation Plan");
    steps.push(plan);
    steps.push("");

    const analysisPrompt = `Analyze this AgentScope operational telemetry for the task "${input}" and extract the 3-5 most important reliability, cost, tool-use, and audit signals.

Splunk context:
${searchSummary}

Custom tool outputs:
${toolResultSummary}`;
    const analysis = await this.generate(analysisPrompt);
    steps.push("## AI Analysis");
    steps.push(analysis);
    steps.push("");

    const reportPrompt = `Based on the Splunk telemetry, custom tool outputs, and analysis, write a production operations report for "${input}".

Structure your report with:
1. Executive Summary
2. Evidence From Splunk
3. Custom Tool Signals
4. Reliability And Cost Findings
5. Recommended Follow-Up
6. Audit Notes

Source data:
Splunk context: ${searchSummary}
Custom tool outputs: ${toolResultSummary}`;

    const report = await this.generate(reportPrompt);
    steps.push("## Final Report");
    steps.push(report);

    return steps.join("\n");
  }

  /**
   * Load every granted tool for this agent and invoke each one once
   * with `{ task: input }`. The returned map is keyed by tool name and
   * contains the (possibly errored) result envelope. Tool failures
   * never break the run; they show up as `{ toolName, error }` in the
   * map and in the `ToolReturned` event payload.
   */
  private async runGrantedTools(
    input: string,
    organizationId: string | undefined,
  ): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();
    if (!organizationId) return results;

    let granted: AgentTool[];
    try {
      granted = await loadGrantedTools(db, {
        agentId: this.id,
        organizationId,
      });
    } catch (error) {
      // If the loader itself throws (e.g. the db is unavailable), skip
      // custom tools rather than failing the whole run. Log so an
      // operator can correlate the missing tool output with a real
      // backend failure.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { agentId: this.id, organizationId, err: message },
        "loadGrantedTools failed; skipping custom tools",
      );
      return results;
    }

    for (const tool of granted) {
      // Skip the built-in search tool, which is already invoked above.
      if (tool.name === this.searchTool.name) continue;
      try {
        const output = await this.useTool(tool, { task: input });
        results.set(tool.name, output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.set(tool.name, { toolName: tool.name, error: message });
      }
    }
    return results;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Truncate a string to a per-prompt char budget. If the string is
 * longer than `limit`, the head is kept (most-recent rows are usually
 * the most relevant) and a `[truncated N chars]` marker is appended so
 * the LLM can see it didn't get the full payload and isn't being asked
 * to summarize missing data.
 */
function truncateForPrompt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const dropped = text.length - limit;
  return `${text.slice(0, limit)}\n... [truncated ${dropped} chars]`;
}
